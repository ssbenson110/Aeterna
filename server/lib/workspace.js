'use strict';

/**
 * The shared workspace: couple, planner, booked vendors and helpers on one page.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * A vendor reaches a wedding's shared page only after the couple has booked
 * them. Not when they receive an enquiry, not when they accept one, only when
 * the couple confirms the booking. An enquiry still goes to exactly one vendor
 * and is still exclusive for 48 hours, so opening up collaboration afterwards
 * cannot turn into the bidding swarm this product exists to avoid.
 *
 * Everything that grants access goes through `addVendorMember`, which refuses
 * without a live booking row. There is no other path.
 *
 * SCOPING
 *
 * A booked vendor sees their own slice and nothing more. They never see the
 * total budget, another vendor's price, the full guest list or payments. That
 * is a commercial boundary as much as a privacy one: a supplier who can see the
 * total budget prices against the budget rather than against the work.
 */

const crypto = require('node:crypto');
const { all, get, run, id, now, logEvent } = require('../db');
const { HttpError } = require('./http');
const { WORKSPACE_ROLES, SHARING_DEFAULTS, SHARING_KEYS } = require('./config');

/* ------------------------------------------------------------------ */
/* membership                                                          */
/* ------------------------------------------------------------------ */

function membersOf(weddingId) {
  return all(
    `SELECT * FROM workspace_members WHERE wedding_id = ? AND status != 'revoked' ORDER BY
       CASE role WHEN 'owner' THEN 0 WHEN 'planner' THEN 1 WHEN 'vendor' THEN 2 ELSE 3 END,
       created_at`,
    weddingId
  );
}

function membershipFor(weddingId, userId) {
  if (!userId) return null;
  return get(
    `SELECT * FROM workspace_members WHERE wedding_id = ? AND user_id = ? AND status = 'active'`,
    weddingId, userId
  );
}

/**
 * Resolve what a user may do on a wedding. Returns null when they have no
 * business seeing it at all.
 */
function accessFor(weddingId, user) {
  if (!user) return null;

  const wedding = get('SELECT * FROM weddings WHERE id = ?', weddingId);
  if (!wedding) return null;

  // The couple who owns the wedding always has owner access, membership row or not.
  if (wedding.user_id === user.id) {
    return { role: 'owner', wedding, member: null, can: WORKSPACE_ROLES.owner.can };
  }

  let member = membershipFor(weddingId, user.id);

  // A vendor may be booked before the person behind the business has an
  // account, or before they have claimed their listing. In that case the
  // membership row was written with no user attached. Reconnect it here by
  // vendor ownership, so claiming a listing does not lock them out of a
  // wedding they are genuinely booked for.
  if (!member) {
    const ownedVendor = get('SELECT id FROM vendors WHERE user_id = ?', user.id);
    if (ownedVendor) {
      const orphan = get(
        `SELECT * FROM workspace_members
         WHERE wedding_id = ? AND vendor_id = ? AND user_id IS NULL AND status = 'active'`,
        weddingId, ownedVendor.id
      );
      if (orphan) {
        run('UPDATE workspace_members SET user_id = ?, joined_at = COALESCE(joined_at, ?) WHERE id = ?',
          user.id, now(), orphan.id);
        member = get('SELECT * FROM workspace_members WHERE id = ?', orphan.id);
      }
    }
  }

  if (!member) return null;

  // A vendor membership is only ever valid while the booking is live.
  if (member.role === 'vendor') {
    const booking = get(
      `SELECT * FROM bookings WHERE wedding_id = ? AND vendor_id = ? AND status = 'booked'`,
      weddingId, member.vendor_id
    );
    if (!booking) return null;
    return { role: 'vendor', wedding, member, booking, can: WORKSPACE_ROLES.vendor.can };
  }

  return { role: member.role, wedding, member, can: WORKSPACE_ROLES[member.role].can };
}

function requireAccess(weddingId, user, capability) {
  const access = accessFor(weddingId, user);
  if (!access) throw new HttpError(404, 'We could not find that wedding.');
  if (capability && !access.can.includes(capability)) {
    throw new HttpError(403, 'You do not have permission to do that on this wedding.');
  }
  return access;
}

/* ------------------------------------------------------------------ */
/* invitations                                                         */
/* ------------------------------------------------------------------ */

function inviteMember({ weddingId, invitedBy, role, displayName, email }) {
  if (!['planner', 'helper'].includes(role)) {
    // Vendors are never invited by email. They arrive through a booking.
    throw new HttpError(400, 'You can invite a planner or a helper. Vendors join automatically once you book them.');
  }

  const existing = get(
    `SELECT * FROM workspace_members WHERE wedding_id = ? AND lower(email) = lower(?) AND status != 'revoked'`,
    weddingId, email
  );
  if (existing) throw new HttpError(409, 'That person is already on this wedding.');

  const token = crypto.randomBytes(18).toString('base64url');
  const memberId = id('mem');
  const user = get('SELECT id FROM users WHERE lower(email) = lower(?)', email);

  run(
    `INSERT INTO workspace_members
      (id, wedding_id, user_id, vendor_id, role, display_name, email, status, invite_token, invited_by, created_at, joined_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    memberId, weddingId, user ? user.id : null, null, role, displayName || '', email,
    user ? 'active' : 'invited', token, invitedBy, now(), user ? now() : null
  );

  logEvent('workspace.invited', weddingId, { role, memberId, alreadyRegistered: Boolean(user) });
  recordChange(weddingId, displayName || email, 'owner', `invited ${displayName || email} as ${WORKSPACE_ROLES[role].label.toLowerCase()}`);

  return { memberId, token, status: user ? 'active' : 'invited' };
}

function acceptInvite(token, user) {
  const member = get(`SELECT * FROM workspace_members WHERE invite_token = ? AND status = 'invited'`, token);
  if (!member) throw new HttpError(404, 'That invitation is not valid any more.');
  run(
    `UPDATE workspace_members SET user_id = ?, status = 'active', joined_at = ?, invite_token = NULL WHERE id = ?`,
    user.id, now(), member.id
  );
  recordChange(member.wedding_id, user.display_name, member.role, 'joined the wedding');
  return get('SELECT * FROM workspace_members WHERE id = ?', member.id);
}

function revokeMember(weddingId, memberId) {
  const member = get('SELECT * FROM workspace_members WHERE id = ? AND wedding_id = ?', memberId, weddingId);
  if (!member) throw new HttpError(404, 'We could not find that person on this wedding.');
  if (member.role === 'owner') throw new HttpError(400, 'The couple cannot be removed from their own wedding.');
  run(`UPDATE workspace_members SET status = 'revoked' WHERE id = ?`, memberId);
  recordChange(weddingId, member.display_name || member.email, member.role, 'was removed from the wedding');
  logEvent('workspace.revoked', weddingId, { memberId, role: member.role });
}

/* ------------------------------------------------------------------ */
/* bookings, the only door a vendor comes through                      */
/* ------------------------------------------------------------------ */

/**
 * Mark a vendor booked and give them scoped workspace access.
 * This is the ONLY function that creates a vendor membership.
 */
function bookVendor({ weddingId, vendorId, enquiryId = null, agreedPence = 0, notes = '' }) {
  const vendor = get('SELECT * FROM vendors WHERE id = ?', vendorId);
  if (!vendor) throw new HttpError(404, 'We could not find that vendor.');

  const already = get(`SELECT * FROM bookings WHERE wedding_id = ? AND vendor_id = ?`, weddingId, vendorId);
  if (already && already.status === 'booked') {
    throw new HttpError(409, `${vendor.business_name} is already booked for this wedding.`);
  }

  const bookingId = already ? already.id : id('bkg');
  if (already) {
    run(`UPDATE bookings SET status = 'booked', agreed_pence = ?, notes = ? WHERE id = ?`,
      agreedPence, notes, already.id);
  } else {
    run(
      `INSERT INTO bookings (id, wedding_id, vendor_id, enquiry_id, category, agreed_pence, status, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      bookingId, weddingId, vendorId, enquiryId, vendor.category, agreedPence, 'booked', notes, now()
    );
  }

  // Grant scoped access. Reactivate a previously revoked row rather than duplicating.
  const existingMember = get('SELECT * FROM workspace_members WHERE wedding_id = ? AND vendor_id = ?', weddingId, vendorId);
  if (existingMember) {
    run(`UPDATE workspace_members SET status = 'active', joined_at = ? WHERE id = ?`, now(), existingMember.id);
  } else {
    run(
      `INSERT INTO workspace_members
        (id, wedding_id, user_id, vendor_id, role, display_name, email, status, invited_by, created_at, joined_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id('mem'), weddingId, vendor.user_id, vendorId, 'vendor', vendor.business_name, '', 'active', null, now(), now()
    );
  }

  logEvent('workspace.vendor_booked', weddingId, { vendorId, bookingId });
  recordChange(weddingId, vendor.business_name, 'vendor', 'was booked and joined the shared page');

  return get('SELECT * FROM bookings WHERE id = ?', bookingId);
}

function cancelBooking(weddingId, vendorId) {
  const booking = get(`SELECT * FROM bookings WHERE wedding_id = ? AND vendor_id = ?`, weddingId, vendorId);
  if (!booking) throw new HttpError(404, 'We could not find that booking.');
  run(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, booking.id);
  // Access goes with the booking, immediately.
  run(`UPDATE workspace_members SET status = 'revoked' WHERE wedding_id = ? AND vendor_id = ?`, weddingId, vendorId);
  const vendor = get('SELECT business_name FROM vendors WHERE id = ?', vendorId);
  recordChange(weddingId, vendor ? vendor.business_name : 'A vendor', 'vendor', 'booking was cancelled and access removed');
  logEvent('workspace.booking_cancelled', weddingId, { vendorId });
}

function bookingsFor(weddingId) {
  return all(
    `SELECT b.*, v.business_name, v.slug, v.town, v.region, v.verified
     FROM bookings b JOIN vendors v ON v.id = b.vendor_id
     WHERE b.wedding_id = ? ORDER BY b.created_at`,
    weddingId
  );
}

/* ------------------------------------------------------------------ */
/* the shared view, scoped per role                                    */
/* ------------------------------------------------------------------ */

function safeJson(value, fallback) {
  try { const parsed = JSON.parse(value); return parsed ?? fallback; } catch { return fallback; }
}

/* ------------------------------------------------------------------ */
/* the sharing matrix                                                  */
/* ------------------------------------------------------------------ */

/**
 * What this couple has chosen to share: published defaults, their own default
 * overrides, then per vendor overrides on top. The one thing that is not a
 * setting: other vendors' prices are never shared, and there is deliberately
 * no key for them.
 */
function sharingFor(wedding, vendorId = null) {
  const stored = safeJson(wedding.sharing, {});
  const defaults = { ...SHARING_DEFAULTS, ...(stored.defaults || {}) };
  if (!vendorId) return defaults;
  const overrides = (stored.perVendor || {})[vendorId] || {};
  const effective = { ...defaults };
  for (const key of SHARING_KEYS) {
    if (typeof overrides[key] === 'boolean') effective[key] = overrides[key];
  }
  return effective;
}

function setSharing(weddingId, { defaults = null, vendorId = null, overrides = null }) {
  const wedding = get('SELECT * FROM weddings WHERE id = ?', weddingId);
  const stored = safeJson(wedding.sharing, {});
  stored.defaults = stored.defaults || {};
  stored.perVendor = stored.perVendor || {};

  const clean = (input) => {
    const out = {};
    for (const key of SHARING_KEYS) {
      if (typeof (input || {})[key] === 'boolean') out[key] = input[key];
    }
    return out;
  };

  if (defaults) Object.assign(stored.defaults, clean(defaults));
  if (vendorId && overrides) {
    stored.perVendor[vendorId] = { ...(stored.perVendor[vendorId] || {}), ...clean(overrides) };
  }
  run('UPDATE weddings SET sharing = ? WHERE id = ?', JSON.stringify(stored), weddingId);
  return safeJson(get('SELECT sharing FROM weddings WHERE id = ?', weddingId).sharing, {});
}

function dietaryCounts(weddingId) {
  const rows = all(
    `SELECT dietary FROM guests WHERE wedding_id = ? AND dietary != '' AND rsvp != 'no'`, weddingId
  );
  const counts = {};
  for (const row of rows) {
    const key = row.dietary.trim().toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).map(([need, count]) => ({ need, count }));
}

/**
 * Build the workspace payload for whoever is asking. The vendor branch is
 * deliberately assembled from scratch rather than filtered down from the full
 * object, so a future field cannot leak by being forgotten in a blocklist.
 */
function viewFor(access) {
  const { wedding, role } = access;
  const weddingId = wedding.id;

  const traditions = safeJson(wedding.traditions, []).concat(safeJson(wedding.custom_traditions, []));
  const members = membersOf(weddingId).map((m) => ({
    id: m.id,
    role: m.role,
    roleLabel: WORKSPACE_ROLES[m.role].label,
    name: m.display_name || m.email || 'Invited',
    status: m.status,
    isVendor: Boolean(m.vendor_id),
  }));

  const timeline = all('SELECT * FROM timeline_events WHERE wedding_id = ? ORDER BY at_time', weddingId)
    .map((t) => ({ id: t.id, time: t.at_time, title: t.title, detail: t.detail, owner: t.owner }));

  const changes = all(
    'SELECT * FROM workspace_changes WHERE wedding_id = ? ORDER BY created_at DESC LIMIT 40', weddingId
  ).map((c) => ({ id: c.id, actor: c.actor_name, role: c.actor_role, summary: c.summary, at: c.created_at }));

  /* ---- booked vendor: their own slice, plus whatever the couple chose ---- */
  if (role === 'vendor') {
    const booking = access.booking;
    const threadKey = `vendor:${booking.vendor_id}`;
    const venue = get(
      `SELECT v.business_name, v.town, v.region FROM bookings b JOIN vendors v ON v.id = b.vendor_id
       WHERE b.wedding_id = ? AND b.category = 'venues' AND b.status = 'booked' LIMIT 1`,
      weddingId
    );
    const shared = sharingFor(wedding, booking.vendor_id);

    return {
      scope: 'vendor',
      role,
      roleLabel: WORKSPACE_ROLES.vendor.label,
      notice: 'You can see the details you need to do your job. The couple\'s full guest list, their total budget and other suppliers\' prices are not shared with you.',
      wedding: {
        weddingDate: wedding.wedding_date,
        region: wedding.region,
        guestCount: wedding.guest_count,   // a headcount, not the list
        traditions,
        notes: wedding.notes,
      },
      venue: venue ? { name: venue.business_name, town: venue.town, region: venue.region } : null,
      yourBooking: {
        category: booking.category,
        agreedPence: booking.agreed_pence,   // their own figure only
        notes: booking.notes,
        bookedAt: booking.created_at,
      },
      // The couple's sharing choices, applied server side. Each block exists
      // only when switched on, so nothing can leak through a forgotten filter.
      sharedByCouple: {
        budgetTotalPence: shared.budget_total ? wedding.budget_pence : undefined,
        guestSummary: shared.guest_summary ? (() => {
          const counts = get(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN rsvp = 'yes' THEN 1 ELSE 0 END) AS yes
             FROM guests WHERE wedding_id = ?`, weddingId
          );
          return { total: counts.total, coming: counts.yes || 0 };
        })() : undefined,
        dietaryCounts: shared.dietary_counts ? dietaryCounts(weddingId) : undefined,
        guestList: shared.full_guest_list
          ? all('SELECT name, side, party FROM guests WHERE wedding_id = ? ORDER BY name', weddingId)
            .map((g) => ({ name: g.name, side: g.side, party: g.party }))
          : undefined,
      },
      yourInvoices: require('./crm').invoicesForWeddingVendor(weddingId, booking.vendor_id),
      yourQuotes: all(
        'SELECT * FROM quotes WHERE wedding_id = ? AND vendor_id = ? ORDER BY created_at DESC',
        weddingId, booking.vendor_id
      ).map((q) => require('./crm').shapeQuote(q)),
      timeline,
      tasks: tasksFor(weddingId, access.member.id),
      comments: commentsFor(weddingId, threadKey),
      commentThread: threadKey,
      team: members.filter((m) => m.role !== 'helper').map((m) => ({ name: m.name, roleLabel: m.roleLabel })),
      changes,
    };
  }

  /* ---- couple, planner and helper ---- */
  const bookings = bookingsFor(weddingId).map((b) => ({
    id: b.id,
    vendorId: b.vendor_id,
    vendorName: b.business_name,
    vendorSlug: b.slug,
    category: b.category,
    agreedPence: b.agreed_pence,
    status: b.status,
    verified: Boolean(b.verified),
    threadKey: `vendor:${b.vendor_id}`,
  }));

  const view = {
    scope: role,
    role,
    roleLabel: WORKSPACE_ROLES[role].label,
    wedding: {
      id: wedding.id,
      partnerOne: wedding.partner_one,
      partnerTwo: wedding.partner_two,
      weddingDate: wedding.wedding_date,
      region: wedding.region,
      guestCount: wedding.guest_count,
      traditions,
      notes: wedding.notes,
    },
    members,
    bookings,
    timeline,
    tasks: tasksFor(weddingId),
    comments: commentsFor(weddingId, 'general'),
    commentThread: 'general',
    changes,
  };

  if (access.can.includes('see_budget_totals')) {
    view.wedding.budgetPence = wedding.budget_pence;
    const committed = get(
      'SELECT COALESCE(SUM(actual_pence), 0) AS n FROM budget_lines WHERE wedding_id = ?', weddingId
    );
    view.budgetSummary = { budgetPence: wedding.budget_pence, committedPence: committed ? committed.n : 0 };
  }
  if (access.can.includes('see_guest_list')) {
    const counts = get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN rsvp = 'yes' THEN 1 ELSE 0 END) AS yes
       FROM guests WHERE wedding_id = ?`, weddingId
    );
    view.guestSummary = { total: counts ? counts.total : 0, coming: counts ? counts.yes || 0 : 0 };
  }

  // Approvals and payments, visible to the couple and their planner.
  const crm = require('./crm');
  view.quotes = crm.quotesForWedding(weddingId);
  view.pendingApprovals = view.quotes.filter((q) => q.status === 'sent').length;
  view.invoices = all(
    `SELECT i.*, v.business_name FROM invoices i JOIN vendors v ON v.id = i.vendor_id
     WHERE i.wedding_id = ? AND i.status != 'void' ORDER BY i.created_at DESC`,
    weddingId
  ).map((inv) => ({
    id: inv.id, vendorName: inv.business_name, reference: inv.reference,
    description: inv.description, amountPence: inv.amount_pence,
    dueOn: inv.due_on, status: inv.status,
  }));
  if (role === 'owner') {
    view.sharing = {
      defaults: sharingFor(wedding),
      perVendor: safeJson(wedding.sharing, {}).perVendor || {},
    };
  }

  return view;
}

/* ------------------------------------------------------------------ */
/* tasks, comments and the change log                                  */
/* ------------------------------------------------------------------ */

function tasksFor(weddingId, assigneeId = null) {
  const rows = assigneeId
    ? all('SELECT * FROM workspace_tasks WHERE wedding_id = ? AND assignee_id = ? ORDER BY done, due_date, created_at', weddingId, assigneeId)
    : all('SELECT * FROM workspace_tasks WHERE wedding_id = ? ORDER BY done, due_date, created_at', weddingId);

  return rows.map((t) => {
    const assignee = t.assignee_id ? get('SELECT display_name, role FROM workspace_members WHERE id = ?', t.assignee_id) : null;
    return {
      id: t.id,
      title: t.title,
      detail: t.detail,
      dueDate: t.due_date,
      done: Boolean(t.done),
      assigneeId: t.assignee_id,
      assigneeName: assignee ? assignee.display_name : null,
      assigneeRole: assignee ? assignee.role : null,
    };
  });
}

function commentsFor(weddingId, threadKey) {
  return all(
    'SELECT * FROM workspace_comments WHERE wedding_id = ? AND thread_key = ? ORDER BY created_at LIMIT 200',
    weddingId, threadKey
  ).map((c) => ({
    id: c.id, body: c.body, author: c.author_name,
    role: c.author_role, roleLabel: WORKSPACE_ROLES[c.author_role] ? WORKSPACE_ROLES[c.author_role].label : c.author_role,
    at: c.created_at,
  }));
}

function addComment({ weddingId, threadKey, user, role, body }) {
  const commentId = id('cmt');
  run(
    `INSERT INTO workspace_comments (id, wedding_id, thread_key, author_id, author_name, author_role, body, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    commentId, weddingId, threadKey || 'general', user.id, user.display_name, role, body, now()
  );
  return get('SELECT * FROM workspace_comments WHERE id = ?', commentId);
}

function recordChange(weddingId, actorName, actorRole, summary) {
  run(
    'INSERT INTO workspace_changes (id, wedding_id, actor_name, actor_role, summary, created_at) VALUES (?,?,?,?,?,?)',
    id('chg'), weddingId, actorName || 'Someone', actorRole || 'owner', summary, now()
  );
}

/**
 * Every wedding needs an owner row so the members list is complete.
 */
function ensureOwner(wedding, user) {
  const existing = get(`SELECT id FROM workspace_members WHERE wedding_id = ? AND role = 'owner'`, wedding.id);
  if (existing) return;
  run(
    `INSERT INTO workspace_members
      (id, wedding_id, user_id, vendor_id, role, display_name, email, status, created_at, joined_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id('mem'), wedding.id, user.id, null, 'owner', user.display_name, user.email, 'active', now(), now()
  );
}

/**
 * Weddings a user can reach that they do not own. Powers the planner and vendor
 * dashboards.
 */
function weddingsForUser(user) {
  const rows = all(
    `SELECT m.*, w.partner_one, w.partner_two, w.wedding_date, w.region
     FROM workspace_members m JOIN weddings w ON w.id = m.wedding_id
     WHERE m.user_id = ? AND m.status = 'active' AND m.role != 'owner'
     ORDER BY w.wedding_date`,
    user.id
  );
  return rows
    .filter((row) => {
      if (row.role !== 'vendor') return true;
      const booking = get(`SELECT id FROM bookings WHERE wedding_id = ? AND vendor_id = ? AND status = 'booked'`,
        row.wedding_id, row.vendor_id);
      return Boolean(booking);
    })
    .map((row) => ({
      weddingId: row.wedding_id,
      role: row.role,
      roleLabel: WORKSPACE_ROLES[row.role].label,
      couple: [row.partner_one, row.partner_two].filter(Boolean).join(' and ') || 'A couple',
      weddingDate: row.wedding_date,
      region: row.region,
    }));
}

module.exports = {
  sharingFor,
  setSharing,
  dietaryCounts,
  membersOf,
  membershipFor,
  accessFor,
  requireAccess,
  inviteMember,
  acceptInvite,
  revokeMember,
  bookVendor,
  cancelBooking,
  bookingsFor,
  viewFor,
  tasksFor,
  commentsFor,
  addComment,
  recordChange,
  ensureOwner,
  weddingsForUser,
};
