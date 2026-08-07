'use strict';

const { all, get, run, now, logEvent } = require('../db');
const { HttpError, str, oneOf, rateLimit } = require('../lib/http');
const { requireUser, requireRole } = require('../lib/auth');
const { CATEGORIES, ENQUIRY_EXCLUSIVITY_HOURS } = require('../lib/config');
const routing = require('../lib/routing');
const entitlements = require('../lib/entitlements');

function shapeEnquiry(row, { forVendor = false } = {}) {
  const vendor = get('SELECT id, slug, business_name, category, town, region FROM vendors WHERE id = ?', row.vendor_id);
  const wedding = get('SELECT * FROM weddings WHERE id = ?', row.wedding_id);
  const traditions = wedding ? routing.weddingTraditions(wedding) : [];

  const base = {
    id: row.id,
    reference: row.reference,
    category: row.category,
    categoryLabel: (CATEGORIES.find((c) => c.slug === row.category) || {}).label || row.category,
    message: row.message,
    status: row.status,
    exclusiveUntil: row.exclusive_until,
    routedReason: row.routed_reason,
    attempt: row.attempt,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    exclusive: true,
    sharedWithOtherVendors: false,
  };

  if (forVendor) {
    return {
      ...base,
      wedding: wedding ? {
        weddingDate: wedding.wedding_date,
        guestCount: wedding.guest_count,
        region: wedding.region,
        budgetPence: wedding.budget_pence,
        traditions,
        // The couple's contact details are released only after a vendor accepts.
        contactReleased: row.status === 'accepted',
      } : null,
    };
  }

  return {
    ...base,
    vendor: vendor ? {
      id: vendor.id, slug: vendor.slug, businessName: vendor.business_name,
      town: vendor.town, region: vendor.region,
    } : null,
  };
}

module.exports = {
  'POST /api/enquiries': async ({ req, body, ip }) => {
    const user = requireRole(req, 'couple');
    const limit = rateLimit(`enquiry:${user.id}`, 12, 24 * 60 * 60 * 1000);
    if (!limit.ok) {
      throw new HttpError(429, 'That is a lot of enquiries in one day. Give the vendors already holding one a chance to reply first.');
    }

    const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
    if (!wedding) throw new HttpError(400, 'Start a plan before sending an enquiry.');

    // The free plan includes one enquiry, so a couple can see the routing work
    // before deciding to pay for the rest.
    entitlements.assertEnquiryAllowed(wedding);

    const category = oneOf(body.category, 'Category', CATEGORIES.map((c) => c.slug));
    const message = str(body.message, 'Message', { max: 2000 });
    const preferredVendorId = body.vendorId ? str(body.vendorId, 'Vendor', { max: 60 }) : null;

    // One live enquiry per category. This is what stops a swarm from the couple side too.
    const live = get(
      `SELECT * FROM enquiries WHERE wedding_id = ? AND category = ? AND status IN ('awaiting_vendor','accepted')`,
      wedding.id, category
    );
    if (live) {
      throw new HttpError(409, {
        message: 'You already have a live enquiry in this category. One enquiry goes to one vendor, so we hold it there until they reply or the window closes.',
        enquiry: shapeEnquiry(live),
      });
    }

    const result = routing.createEnquiry({
      wedding,
      coupleUserId: user.id,
      category,
      message,
      preferredVendorId,
    });

    if (!result.ok) {
      throw new HttpError(409, 'We do not have an available vendor matching that category and region right now. Try a wider region, or come back shortly.');
    }

    const enquiry = get('SELECT * FROM enquiries WHERE id = ?', result.enquiryId);
    return {
      status: 201,
      body: {
        enquiry: shapeEnquiry(enquiry),
        routing: {
          reason: result.reason,
          vendorsContacted: 1,
          exclusiveHours: ENQUIRY_EXCLUSIVITY_HOURS,
          note: 'This enquiry went to one vendor. Nobody else received it, and your details were not sold to anyone.',
        },
      },
    };
  },

  'GET /api/enquiries': async ({ req, query }) => {
    const user = requireUser(req);

    if (user.role === 'vendor') {
      const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
      if (!vendor) return { body: { enquiries: [] } };
      const rows = all(
        'SELECT * FROM enquiries WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 100',
        vendor.id
      );
      return { body: { enquiries: rows.map((r) => shapeEnquiry(r, { forVendor: true })) } };
    }

    const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
    if (!wedding) return { body: { enquiries: [] } };
    const rows = all('SELECT * FROM enquiries WHERE wedding_id = ? ORDER BY created_at DESC LIMIT 100', wedding.id);
    return { body: { enquiries: rows.map((r) => shapeEnquiry(r)) } };
  },

  'GET /api/enquiries/:id': async ({ req, params }) => {
    const user = requireUser(req);
    const row = get('SELECT * FROM enquiries WHERE id = ?', params.id);
    if (!row) throw new HttpError(404, 'We could not find that enquiry.');

    if (user.role === 'vendor') {
      const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
      if (!vendor || vendor.id !== row.vendor_id) throw new HttpError(403, 'That enquiry is not yours.');
      return { body: { enquiry: shapeEnquiry(row, { forVendor: true }) } };
    }
    if (row.couple_user_id !== user.id) throw new HttpError(403, 'That enquiry is not yours.');
    return { body: { enquiry: shapeEnquiry(row) } };
  },

  'POST /api/enquiries/:id/respond': async ({ req, params, body }) => {
    const user = requireRole(req, 'vendor');
    const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
    if (!vendor) throw new HttpError(400, 'Create your vendor profile first.');

    const row = get('SELECT * FROM enquiries WHERE id = ?', params.id);
    if (!row) throw new HttpError(404, 'We could not find that enquiry.');
    if (row.vendor_id !== vendor.id) throw new HttpError(403, 'That enquiry is not yours.');
    if (row.status !== 'awaiting_vendor') throw new HttpError(409, 'That enquiry has already been answered.');

    const decision = oneOf(body.decision, 'Decision', ['accept', 'decline']);

    if (decision === 'accept') {
      run(`UPDATE enquiries SET status = 'accepted', responded_at = ?, pipeline_stage = 'in_conversation' WHERE id = ?`, now(), row.id);
      logEvent('enquiry.accepted', row.id, { vendorId: vendor.id });
      const updated = get('SELECT * FROM enquiries WHERE id = ?', row.id);
      return { body: { enquiry: shapeEnquiry(updated, { forVendor: true }), contactReleased: true } };
    }

    run(`UPDATE enquiries SET status = 'declined', responded_at = ?, pipeline_stage = 'closed_lost' WHERE id = ?`, now(), row.id);
    logEvent('enquiry.declined', row.id, { vendorId: vendor.id });
    const rerouted = routing.rerouteEnquiry(row.id);

    return {
      body: {
        declined: true,
        rerouted: rerouted.ok,
        note: rerouted.ok
          ? 'The enquiry has moved on to one other vendor. It was never held by two vendors at once.'
          : 'There is no other matching vendor available, so the couple has been told plainly rather than left waiting.',
      },
    };
  },

  'POST /api/enquiries/sweep': async () => {
    // Idempotent maintenance endpoint. Also runs on a timer inside the server.
    const result = routing.sweepExpired();
    return { body: result };
  },
};

module.exports.shapeEnquiry = shapeEnquiry;
