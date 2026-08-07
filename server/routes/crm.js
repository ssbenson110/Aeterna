'use strict';

/**
 * Vendor CRM endpoints, couple approvals, the sharing matrix, guest messaging
 * and the public RSVP pages.
 */

const { all, get, run, id, now } = require('../db');
const { HttpError, str, int, oneOf, isoDate, rateLimit } = require('../lib/http');
const { requireUser, requireRole } = require('../lib/auth');
const workspace = require('../lib/workspace');
const crm = require('../lib/crm');
const {
  PIPELINE_STAGES, PIPELINE_STAGE_KEYS, SHARING_KEYS, SHARING_LABELS,
} = require('../lib/config');
const crypto = require('node:crypto');

/** Guests created before tokens existed get one the first time it is needed. */
function tokenFor(guest) {
  if (guest.rsvp_token) return guest.rsvp_token;
  const token = crypto.randomBytes(12).toString('base64url');
  run('UPDATE guests SET rsvp_token = ? WHERE id = ?', token, guest.id);
  return token;
}

function myVendor(req) {
  const user = requireRole(req, 'vendor');
  const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
  if (!vendor) throw new HttpError(404, 'Create your listing first.');
  return { user, vendor };
}

function myWedding(req) {
  const user = requireRole(req, 'couple');
  const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
  if (!wedding) throw new HttpError(404, 'We could not find your plan.');
  return { user, wedding };
}

module.exports = {
  /* ================================================================ */
  /* vendor CRM                                                       */
  /* ================================================================ */

  'GET /api/crm/pipeline': async ({ req }) => {
    const { vendor } = myVendor(req);
    return {
      body: {
        ...crm.pipelineFor(vendor.id),
        stageLabels: PIPELINE_STAGES,
      },
    };
  },

  'PATCH /api/crm/enquiries/:enquiryId': async ({ req, params, body }) => {
    const { vendor } = myVendor(req);
    const enquiry = get('SELECT * FROM enquiries WHERE id = ? AND vendor_id = ?', params.enquiryId, vendor.id);
    if (!enquiry) throw new HttpError(404, 'We could not find that enquiry.');
    if (body.stage !== undefined) {
      crm.setStage(enquiry.id, oneOf(body.stage, 'Stage', PIPELINE_STAGE_KEYS));
    }
    if (body.notes !== undefined) {
      // The vendor's private working notes. Never shown to the couple.
      run('UPDATE enquiries SET vendor_notes = ? WHERE id = ?',
        str(body.notes, 'Notes', { max: 4000 }), enquiry.id);
    }
    return { body: { ok: true } };
  },

  'POST /api/crm/quotes': async ({ req, body }) => {
    const { vendor } = myVendor(req);
    const quote = crm.sendQuote({
      vendor,
      weddingId: str(body.weddingId, 'Wedding', { required: true, max: 60 }),
      enquiryId: body.enquiryId ? str(body.enquiryId, 'Enquiry', { max: 60 }) : null,
      title: str(body.title, 'Title', { required: true, max: 160 }),
      description: str(body.description, 'Description', { max: 4000 }),
      amountPence: int(body.amountPence, 'Amount', { min: 1, max: 100_000_000 }),
    });
    return {
      status: 201,
      body: {
        quote,
        note: 'Sent. The couple sees it on their shared page and decides there, so the agreement is on the record for both of you.',
      },
    };
  },

  'POST /api/crm/quotes/:quoteId/withdraw': async ({ req, params }) => {
    const { vendor } = myVendor(req);
    return { body: { quote: crm.withdrawQuote(vendor, params.quoteId) } };
  },

  'GET /api/crm/invoices': async ({ req }) => {
    const { vendor } = myVendor(req);
    const invoices = crm.invoicesForVendor(vendor.id);
    const owed = invoices.filter((i) => i.status === 'unpaid').reduce((sum, i) => sum + i.amountPence, 0);
    const collected = invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.amountPence, 0);
    return { body: { invoices, owedPence: owed, collectedPence: collected } };
  },

  'POST /api/crm/invoices': async ({ req, body }) => {
    const { vendor } = myVendor(req);
    const invoice = crm.raiseInvoice({
      vendor,
      weddingId: str(body.weddingId, 'Wedding', { required: true, max: 60 }),
      description: str(body.description, 'Description', { max: 500 }),
      amountPence: int(body.amountPence, 'Amount', { min: 1, max: 100_000_000 }),
      dueOn: body.dueOn ? isoDate(body.dueOn, 'Due date') : null,
    });
    return {
      status: 201,
      body: {
        invoice,
        note: 'Raised. The couple sees it on their shared page. This tracks what is owed, it does not take the payment.',
      },
    };
  },

  'PATCH /api/crm/invoices/:invoiceId': async ({ req, params, body }) => {
    const { vendor } = myVendor(req);
    const invoice = crm.settleInvoice(vendor, params.invoiceId,
      oneOf(body.status, 'Status', ['paid', 'unpaid', 'void']));
    return { body: { invoice } };
  },

  /* ---------------- availability ---------------- */

  'GET /api/crm/availability': async ({ req }) => {
    const { vendor } = myVendor(req);
    return {
      body: {
        blackouts: crm.blackoutsFor(vendor.id),
        note: 'A date you block out never receives an enquiry. It is a hard filter in the router, not a preference.',
      },
    };
  },

  'POST /api/crm/availability': async ({ req, body }) => {
    const { vendor } = myVendor(req);
    return {
      status: 201,
      body: {
        blackouts: crm.addBlackout(vendor.id,
          isoDate(body.date, 'Date'),
          str(body.note, 'Note', { max: 200 })),
      },
    };
  },

  'DELETE /api/crm/availability/:blackoutId': async ({ req, params }) => {
    const { vendor } = myVendor(req);
    return { body: { blackouts: crm.removeBlackout(vendor.id, params.blackoutId) } };
  },

  /* ================================================================ */
  /* couple approvals                                                 */
  /* ================================================================ */

  'POST /api/quotes/:quoteId/decide': async ({ req, params, body }) => {
    const { user, wedding } = myWedding(req);
    const decision = oneOf(body.decision, 'Decision', ['approve', 'decline']);
    const result = crm.decideQuote({ wedding, user, quoteId: params.quoteId, decision });
    return {
      body: {
        ...result,
        note: decision === 'approve'
          ? 'Approved. The vendor is booked at the quoted amount and has joined your shared page, scoped to their own work.'
          : 'Declined. The vendor can see the decision and nothing else changes.',
      },
    };
  },

  /* ================================================================ */
  /* the sharing matrix                                               */
  /* ================================================================ */

  'GET /api/workspace/:weddingId/sharing': async ({ req, params }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user);
    if (access.role !== 'owner') {
      throw new HttpError(403, 'Only the couple decides who sees what.');
    }
    const stored = workspace.sharingFor(access.wedding);
    return {
      body: {
        defaults: stored,
        perVendor: JSON.parse(access.wedding.sharing || '{}').perVendor || {},
        keys: SHARING_KEYS.map((key) => ({ key, ...SHARING_LABELS[key] })),
        neverShared: [
          'What other vendors are charging. This is not a setting, it is a rule.',
        ],
      },
    };
  },

  'PATCH /api/workspace/:weddingId/sharing': async ({ req, params, body }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user);
    if (access.role !== 'owner') {
      throw new HttpError(403, 'Only the couple decides who sees what.');
    }
    const stored = workspace.setSharing(params.weddingId, {
      defaults: body.defaults || null,
      vendorId: body.vendorId ? str(body.vendorId, 'Vendor', { max: 60 }) : null,
      overrides: body.overrides || null,
    });
    workspace.recordChange(params.weddingId, user.display_name, 'owner', 'changed who can see what');
    return { body: { sharing: stored } };
  },

  /* ================================================================ */
  /* guest messaging and RSVP                                         */
  /* ================================================================ */

  /**
   * Compose once, send through channels the couple already has. Email
   * delivery is not connected, so each guest gets a WhatsApp link and a mail
   * link carrying the message and their personal RSVP page. Honest, and it
   * works today.
   */
  'POST /api/planner/guest-messages': async ({ req, body, url }) => {
    const { wedding } = myWedding(req);
    const subject = str(body.subject, 'Subject', { required: true, max: 160 });
    const messageBody = str(body.body, 'Message', { required: true, max: 2000 });
    const audience = oneOf(body.audience, 'Audience', ['all', 'yes', 'pending'], 'all');

    run(
      'INSERT INTO guest_messages (id, wedding_id, subject, body, audience, created_at) VALUES (?,?,?,?,?,?)',
      id('gms'), wedding.id, subject, messageBody, audience, now()
    );

    const guests = all(
      audience === 'all'
        ? 'SELECT * FROM guests WHERE wedding_id = ?'
        : 'SELECT * FROM guests WHERE wedding_id = ? AND rsvp = ?',
      ...(audience === 'all' ? [wedding.id] : [wedding.id, audience === 'yes' ? 'yes' : 'pending'])
    );

    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;
    const links = guests.map((guest) => {
      const rsvpUrl = `${origin}/#/rsvp/${tokenFor(guest)}`;
      const text = `${messageBody}\n\nReply here: ${rsvpUrl}`;
      return {
        guestId: guest.id,
        name: guest.name,
        rsvp: guest.rsvp,
        rsvpUrl,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`Hi ${guest.name.split(' ')[0]}, ${text}`)}`,
        mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Hi ${guest.name.split(' ')[0]},\n\n${text}`)}`,
      };
    });

    return {
      status: 201,
      body: {
        recipients: links,
        note: 'Email delivery is not connected in this build, so each guest has a WhatsApp and a mail link carrying your message and their personal reply page. Send them from your own phone or inbox.',
      },
    };
  },

  'GET /api/planner/guest-messages': async ({ req }) => {
    const { wedding } = myWedding(req);
    return {
      body: {
        messages: all(
          'SELECT * FROM guest_messages WHERE wedding_id = ? ORDER BY created_at DESC LIMIT 50', wedding.id
        ).map((m) => ({
          id: m.id, subject: m.subject, body: m.body, audience: m.audience, at: m.created_at,
        })),
      },
    };
  },

  /**
   * The guest's personal reply page. Public by design: a guest should not
   * need an account to say yes. The token is the whole secret, so it is long,
   * random, and reveals nothing but this one guest's own row.
   */
  'GET /api/rsvp/:token': async ({ params }) => {
    const guest = get('SELECT * FROM guests WHERE rsvp_token = ?', params.token);
    if (!guest) throw new HttpError(404, 'This reply link is not valid. Check with the couple for a fresh one.');
    const wedding = get('SELECT * FROM weddings WHERE id = ?', guest.wedding_id);
    return {
      body: {
        guestName: guest.name,
        rsvp: guest.rsvp,
        dietary: guest.dietary,
        note: guest.rsvp_note || '',
        couple: [wedding.partner_one, wedding.partner_two].filter(Boolean).join(' and ') || 'The couple',
        weddingDate: wedding.wedding_date,
        region: wedding.region,
      },
    };
  },

  'POST /api/rsvp/:token': async ({ params, body, ip }) => {
    const limit = rateLimit(`rsvp:${ip}`, 20, 10 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Too many replies from this connection. Give it a few minutes.');

    const guest = get('SELECT * FROM guests WHERE rsvp_token = ?', params.token);
    if (!guest) throw new HttpError(404, 'This reply link is not valid. Check with the couple for a fresh one.');

    const rsvp = oneOf(body.rsvp, 'Reply', ['yes', 'no']);
    run('UPDATE guests SET rsvp = ?, dietary = ?, rsvp_note = ? WHERE id = ?',
      rsvp,
      str(body.dietary, 'Dietary needs', { max: 200 }),
      str(body.note, 'Note', { max: 500 }),
      guest.id);

    workspace.recordChange(guest.wedding_id, guest.name, 'helper',
      rsvp === 'yes' ? 'replied yes to the invitation' : 'sent apologies');

    return {
      body: {
        saved: true,
        rsvp,
        note: rsvp === 'yes'
          ? 'Lovely, you are on the list. You can come back to this page and change your reply if plans shift.'
          : 'Thank you for letting them know. You can come back and change this if plans shift.',
      },
    };
  },

  /**
   * The couple's view of the send list: every guest with their reply link, so
   * links can be reshared one at a time without composing a new message.
   */
  'GET /api/planner/guest-links': async ({ req }) => {
    const { wedding } = myWedding(req);
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;
    return {
      body: {
        guests: all('SELECT * FROM guests WHERE wedding_id = ? ORDER BY name', wedding.id).map((g) => ({
          id: g.id,
          name: g.name,
          rsvp: g.rsvp,
          rsvpUrl: `${origin}/#/rsvp/${tokenFor(g)}`,
        })),
      },
    };
  },
};
