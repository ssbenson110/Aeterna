'use strict';

/**
 * The vendor CRM: pipeline, quotes, invoices and availability, plus the
 * supply cap that decides whether a new vendor may join a patch at all.
 *
 * Two rules run through everything here:
 *
 * 1. A quote is the only proposal channel, and approval happens on the shared
 *    page in front of everyone it affects. An approved quote is what creates
 *    the booking, so "who agreed what, and when" is always answerable.
 *
 * 2. The cap keeps vendor supply behind couple demand. A vendor paying for a
 *    patch with no enquiries is a refund and a bad review waiting to happen,
 *    so onboarding waitlists rather than overselling.
 */

const { all, get, run, id, now, logEvent } = require('../db');
const { HttpError } = require('./http');
const {
  PIPELINE_STAGES, PIPELINE_STAGE_KEYS, SUPPLY_CAP, REGION_GROUPS,
} = require('./config');
const workspace = require('./workspace');

/* ------------------------------------------------------------------ */
/* pipeline                                                            */
/* ------------------------------------------------------------------ */

function setStage(enquiryId, stage, { silent = false } = {}) {
  if (!PIPELINE_STAGE_KEYS.includes(stage)) {
    throw new HttpError(400, 'That is not a pipeline stage.');
  }
  run('UPDATE enquiries SET pipeline_stage = ? WHERE id = ?', stage, enquiryId);
  if (!silent) logEvent('crm.stage', enquiryId, { stage });
}

/**
 * The vendor's board: every enquiry they hold, grouped by stage, with the
 * quotes and any booking attached so a card tells the whole story.
 */
function pipelineFor(vendorId) {
  const enquiries = all(
    `SELECT e.*, w.wedding_date, w.guest_count, w.region AS wedding_region
     FROM enquiries e JOIN weddings w ON w.id = e.wedding_id
     WHERE e.vendor_id = ? ORDER BY e.created_at DESC LIMIT 200`,
    vendorId
  );

  const cards = enquiries.map((enquiry) => {
    const quotes = all(
      'SELECT * FROM quotes WHERE enquiry_id = ? ORDER BY created_at DESC', enquiry.id
    );
    const booking = get(
      `SELECT * FROM bookings WHERE wedding_id = ? AND vendor_id = ? AND status = 'booked'`,
      enquiry.wedding_id, enquiry.vendor_id
    );
    // The stage is derived where the data already knows better than the label.
    let stage = enquiry.pipeline_stage || 'new';
    if (booking) stage = 'booked';
    else if (enquiry.status === 'declined' || enquiry.status === 'no_match') stage = 'closed_lost';
    else if (quotes.some((q) => q.status === 'sent') && stage === 'new') stage = 'quoted';

    return {
      enquiryId: enquiry.id,
      weddingId: enquiry.wedding_id,
      reference: enquiry.reference,
      category: enquiry.category,
      status: enquiry.status,
      stage,
      weddingDate: enquiry.wedding_date,
      guestCount: enquiry.guest_count,
      region: enquiry.wedding_region,
      message: enquiry.message,
      notes: enquiry.vendor_notes || '',
      createdAt: enquiry.created_at,
      contactReleased: enquiry.status === 'accepted' || Boolean(booking),
      quotes: quotes.map(shapeQuote),
      booked: Boolean(booking),
      agreedPence: booking ? booking.agreed_pence : null,
    };
  });

  const board = PIPELINE_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    cards: cards.filter((c) => c.stage === stage.key),
  }));

  return { stages: board, total: cards.length };
}

/* ------------------------------------------------------------------ */
/* quotes: the approval mechanism                                      */
/* ------------------------------------------------------------------ */

function shapeQuote(q) {
  return {
    id: q.id,
    weddingId: q.wedding_id,
    vendorId: q.vendor_id,
    enquiryId: q.enquiry_id,
    title: q.title,
    description: q.description,
    amountPence: q.amount_pence,
    status: q.status,
    createdAt: q.created_at,
    decidedAt: q.decided_at,
  };
}

/**
 * A vendor may only quote a wedding they hold a live enquiry from, or are
 * already booked on. No enquiry, no quote: quoting strangers would be spam.
 */
function sendQuote({ vendor, weddingId, enquiryId, title, description, amountPence }) {
  const standing = get(
    `SELECT id FROM enquiries WHERE wedding_id = ? AND vendor_id = ? AND status IN ('awaiting_vendor','accepted')`,
    weddingId, vendor.id
  ) || get(
    `SELECT id FROM bookings WHERE wedding_id = ? AND vendor_id = ? AND status = 'booked'`,
    weddingId, vendor.id
  );
  if (!standing) {
    throw new HttpError(403, 'You can only send a quote to a couple whose enquiry you hold or who has already booked you.');
  }
  if (!Number.isFinite(amountPence) || amountPence <= 0) {
    throw new HttpError(400, 'A quote needs an amount.');
  }

  const quoteId = id('qot');
  run(
    `INSERT INTO quotes (id, wedding_id, vendor_id, enquiry_id, title, description, amount_pence, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    quoteId, weddingId, vendor.id, enquiryId || null,
    String(title).slice(0, 160), String(description || '').slice(0, 4000),
    Math.round(amountPence), 'sent', now()
  );
  if (enquiryId) setStage(enquiryId, 'quoted', { silent: true });

  workspace.recordChange(weddingId, vendor.business_name, 'vendor',
    `sent a quote, "${String(title).slice(0, 60)}"`);
  logEvent('quote.sent', quoteId, { vendorId: vendor.id, weddingId });
  return shapeQuote(get('SELECT * FROM quotes WHERE id = ?', quoteId));
}

function withdrawQuote(vendor, quoteId) {
  const quote = get('SELECT * FROM quotes WHERE id = ? AND vendor_id = ?', quoteId, vendor.id);
  if (!quote) throw new HttpError(404, 'We could not find that quote.');
  if (quote.status !== 'sent') throw new HttpError(409, 'Only a quote still awaiting a decision can be withdrawn.');
  run(`UPDATE quotes SET status = 'withdrawn', decided_at = ? WHERE id = ?`, now(), quoteId);
  workspace.recordChange(quote.wedding_id, vendor.business_name, 'vendor', 'withdrew a quote');
  return shapeQuote(get('SELECT * FROM quotes WHERE id = ?', quoteId));
}

/**
 * The couple decides, on the page. Approval creates the booking with the
 * quoted amount, which in turn opens the vendor's scoped workspace access.
 * This is the approvals flow: nothing is agreed anywhere else.
 */
function decideQuote({ wedding, user, quoteId, decision }) {
  const quote = get('SELECT * FROM quotes WHERE id = ? AND wedding_id = ?', quoteId, wedding.id);
  if (!quote) throw new HttpError(404, 'We could not find that quote.');
  if (quote.status !== 'sent') throw new HttpError(409, 'That quote has already been decided.');

  const vendor = get('SELECT * FROM vendors WHERE id = ?', quote.vendor_id);

  if (decision === 'decline') {
    run(`UPDATE quotes SET status = 'declined', decided_at = ? WHERE id = ?`, now(), quoteId);
    workspace.recordChange(wedding.id, user.display_name, 'owner',
      `declined ${vendor.business_name}'s quote`);
    logEvent('quote.declined', quoteId, {});
    require('./routing').notifyVendor(vendor.id, {
      subject: 'A decision on your quote',
      bodyText: `The couple declined "${quote.title}". The enquiry stays open, so a revised quote is always an option.`,
      ctaLabel: 'Open your pipeline',
    });
    return { quote: shapeQuote(get('SELECT * FROM quotes WHERE id = ?', quoteId)), booking: null };
  }

  run(`UPDATE quotes SET status = 'approved', decided_at = ? WHERE id = ?`, now(), quoteId);
  const booking = workspace.bookVendor({
    weddingId: wedding.id,
    vendorId: quote.vendor_id,
    enquiryId: quote.enquiry_id,
    agreedPence: quote.amount_pence,
    notes: `Approved quote: ${quote.title}`,
  });
  if (quote.enquiry_id) setStage(quote.enquiry_id, 'booked', { silent: true });

  workspace.recordChange(wedding.id, user.display_name, 'owner',
    `approved ${vendor.business_name}'s quote for "${quote.title}"`);
  logEvent('quote.approved', quoteId, { bookingId: booking.id });
  require('./routing').notifyVendor(vendor.id, {
    subject: 'Your quote was approved, you are booked',
    bodyText: `The couple approved "${quote.title}" at £${(quote.amount_pence / 100).toFixed(2)}. You are booked, and their shared page is open to you, scoped to your own work.`,
    ctaLabel: 'Open the shared page',
  });
  return { quote: shapeQuote(get('SELECT * FROM quotes WHERE id = ?', quoteId)), booking };
}

function quotesForWedding(weddingId) {
  return all(
    `SELECT q.*, v.business_name, v.slug FROM quotes q
     JOIN vendors v ON v.id = q.vendor_id
     WHERE q.wedding_id = ? ORDER BY q.created_at DESC`,
    weddingId
  ).map((q) => ({ ...shapeQuote(q), vendorName: q.business_name, vendorSlug: q.slug }));
}

/* ------------------------------------------------------------------ */
/* invoices: tracking, not taking                                      */
/* ------------------------------------------------------------------ */

function shapeInvoice(inv) {
  return {
    id: inv.id,
    weddingId: inv.wedding_id,
    vendorId: inv.vendor_id,
    reference: inv.reference,
    description: inv.description,
    amountPence: inv.amount_pence,
    dueOn: inv.due_on,
    status: inv.status,
    createdAt: inv.created_at,
    paidAt: inv.paid_at,
  };
}

function raiseInvoice({ vendor, weddingId, description, amountPence, dueOn }) {
  const booking = get(
    `SELECT id FROM bookings WHERE wedding_id = ? AND vendor_id = ? AND status = 'booked'`,
    weddingId, vendor.id
  );
  if (!booking) throw new HttpError(403, 'Invoices can only be raised against a wedding that has booked you.');
  if (!Number.isFinite(amountPence) || amountPence <= 0) throw new HttpError(400, 'An invoice needs an amount.');

  const count = get('SELECT COUNT(*) AS n FROM invoices WHERE vendor_id = ?', vendor.id).n;
  const reference = `INV-${String(1001 + count)}`;

  const invoiceId = id('inv2');
  run(
    `INSERT INTO invoices (id, wedding_id, vendor_id, reference, description, amount_pence, due_on, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    invoiceId, weddingId, vendor.id, reference,
    String(description || '').slice(0, 500), Math.round(amountPence), dueOn || null, 'unpaid', now()
  );
  workspace.recordChange(weddingId, vendor.business_name, 'vendor',
    `raised invoice ${reference}${dueOn ? `, due ${dueOn}` : ''}`);
  return shapeInvoice(get('SELECT * FROM invoices WHERE id = ?', invoiceId));
}

function settleInvoice(vendor, invoiceId, status) {
  const invoice = get('SELECT * FROM invoices WHERE id = ? AND vendor_id = ?', invoiceId, vendor.id);
  if (!invoice) throw new HttpError(404, 'We could not find that invoice.');
  if (!['paid', 'unpaid', 'void'].includes(status)) throw new HttpError(400, 'That is not an invoice status.');
  run('UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?',
    status, status === 'paid' ? now() : null, invoiceId);
  if (status === 'paid') {
    workspace.recordChange(invoice.wedding_id, vendor.business_name, 'vendor',
      `marked invoice ${invoice.reference} as paid`);
  }
  return shapeInvoice(get('SELECT * FROM invoices WHERE id = ?', invoiceId));
}

function invoicesForVendor(vendorId) {
  return all(
    `SELECT i.*, w.partner_one, w.partner_two FROM invoices i
     JOIN weddings w ON w.id = i.wedding_id
     WHERE i.vendor_id = ? ORDER BY i.created_at DESC LIMIT 200`,
    vendorId
  ).map((inv) => ({
    ...shapeInvoice(inv),
    couple: [inv.partner_one, inv.partner_two].filter(Boolean).join(' and ') || 'A couple',
  }));
}

function invoicesForWeddingVendor(weddingId, vendorId) {
  return all(
    'SELECT * FROM invoices WHERE wedding_id = ? AND vendor_id = ? ORDER BY created_at DESC',
    weddingId, vendorId
  ).map(shapeInvoice);
}

/* ------------------------------------------------------------------ */
/* availability                                                        */
/* ------------------------------------------------------------------ */

function blackoutsFor(vendorId) {
  return all(
    'SELECT * FROM vendor_blackouts WHERE vendor_id = ? ORDER BY on_date', vendorId
  ).map((b) => ({ id: b.id, date: b.on_date, note: b.note }));
}

function addBlackout(vendorId, onDate, note) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(onDate || ''))) {
    throw new HttpError(400, 'Dates take the YYYY-MM-DD form.');
  }
  const existing = get('SELECT id FROM vendor_blackouts WHERE vendor_id = ? AND on_date = ?', vendorId, onDate);
  if (existing) return blackoutsFor(vendorId);
  run('INSERT INTO vendor_blackouts (id, vendor_id, on_date, note, created_at) VALUES (?,?,?,?,?)',
    id('blk'), vendorId, onDate, String(note || '').slice(0, 200), now());
  return blackoutsFor(vendorId);
}

function removeBlackout(vendorId, blackoutId) {
  run('DELETE FROM vendor_blackouts WHERE id = ? AND vendor_id = ?', blackoutId, vendorId);
  return blackoutsFor(vendorId);
}

function isBlackedOut(vendorId, onDate) {
  if (!onDate) return false;
  return Boolean(get('SELECT id FROM vendor_blackouts WHERE vendor_id = ? AND on_date = ?', vendorId, onDate));
}

/* ------------------------------------------------------------------ */
/* the supply cap                                                      */
/* ------------------------------------------------------------------ */

const GROUP_OF = {};
for (const group of REGION_GROUPS) {
  for (const region of group.items) GROUP_OF[region] = group.label;
}

/**
 * How many vendors a category can hold in a region group right now.
 * The floor keeps a cold patch open to its first few vendors; beyond that,
 * capacity has to be earned by enquiry demand.
 */
function capFor(category, region) {
  const group = GROUP_OF[region];
  const groupRegions = group
    ? (REGION_GROUPS.find((g) => g.label === group) || { items: [region] }).items
    : [region];

  const placeholders = groupRegions.map(() => '?').join(',');
  const since = new Date(Date.now() - SUPPLY_CAP.windowDays * 864e5).toISOString();

  const enquiries30d = get(
    `SELECT COUNT(*) AS n FROM enquiries e
     JOIN weddings w ON w.id = e.wedding_id
     WHERE e.category = ? AND e.created_at >= ? AND w.region IN (${placeholders})`,
    category, since, ...groupRegions
  ).n;

  const active = get(
    `SELECT COUNT(*) AS n FROM vendors
     WHERE category = ? AND is_sample = 0 AND region IN (${placeholders})`,
    category, ...groupRegions
  ).n;

  const cap = Math.max(SUPPLY_CAP.floorPerPatch, Math.ceil(enquiries30d * SUPPLY_CAP.perEnquiry30d));
  return {
    category,
    regionGroup: group || region,
    cap,
    active,
    enquiries30d,
    open: active < cap,
    remaining: Math.max(0, cap - active),
  };
}

/**
 * Called at vendor creation. Either clears them to join, or records them on
 * the waitlist and explains honestly why.
 */
function admitOrWaitlist({ userId, businessName, category, region }) {
  const patch = capFor(category, region);
  if (patch.open) return { admitted: true, patch };

  const existing = get(
    `SELECT id FROM vendor_waitlist WHERE user_id = ? AND category = ? AND status = 'waiting'`,
    userId, category
  );
  if (!existing) {
    run(
      `INSERT INTO vendor_waitlist (id, user_id, business_name, category, region, status, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      id('wtl'), userId, String(businessName).slice(0, 160), category, region, 'waiting', now()
    );
    logEvent('waitlist.joined', userId, { category, region });
  }

  const position = get(
    `SELECT COUNT(*) AS n FROM vendor_waitlist
     WHERE category = ? AND status = 'waiting' AND created_at <= (
       SELECT created_at FROM vendor_waitlist WHERE user_id = ? AND category = ? AND status = 'waiting'
     )`,
    category, userId, category
  ).n;

  return { admitted: false, patch, position };
}

function waitlist() {
  return all(
    `SELECT * FROM vendor_waitlist WHERE status = 'waiting' ORDER BY created_at`
  ).map((row) => ({
    id: row.id,
    businessName: row.business_name,
    category: row.category,
    region: row.region,
    since: row.created_at,
    patch: capFor(row.category, row.region),
  }));
}

module.exports = {
  setStage,
  pipelineFor,
  sendQuote,
  withdrawQuote,
  decideQuote,
  quotesForWedding,
  shapeQuote,
  raiseInvoice,
  settleInvoice,
  invoicesForVendor,
  invoicesForWeddingVendor,
  blackoutsFor,
  addBlackout,
  removeBlackout,
  isBlackedOut,
  capFor,
  admitOrWaitlist,
  waitlist,
};
