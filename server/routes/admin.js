'use strict';

/**
 * Admin console endpoints.
 *
 * Every handler here is admin only. Note what is deliberately absent: there is
 * no endpoint that sets `verified` directly. An admin records the outcome of
 * each published check and the badge is derived in lib/verification.js. That is
 * the whole point, so please do not add a shortcut.
 */

const { all, get, run, id, now } = require('../db');
const { HttpError, str, int, bool, oneOf, isEmail, isoDate } = require('../lib/http');
const { requireUser } = require('../lib/auth');
const verification = require('../lib/verification');
const uploads = require('../lib/uploads');
const {
  VERIFICATION_CHECKS, VERIFICATION_SCOPE, CATEGORIES, REGIONS,
  INSURANCE_CHASE_DAYS, RECHECK_INTERVAL_DAYS, UPLOADS,
} = require('../lib/config');

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') {
    throw new HttpError(403, 'The verification console is for AETERNA staff.');
  }
  return user;
}

function vendorOr404(vendorId) {
  const vendor = get('SELECT * FROM vendors WHERE id = ?', vendorId);
  if (!vendor) throw new HttpError(404, 'We could not find that vendor.');
  return vendor;
}

module.exports = {
  /**
   * Reference data for the console: the six checks, the published scope they
   * come from, and the operational thresholds.
   */
  'GET /api/admin/meta': async ({ req }) => {
    requireAdmin(req);
    return {
      body: {
        checks: VERIFICATION_CHECKS,
        scope: VERIFICATION_SCOPE,
        categories: CATEGORIES,
        regions: REGIONS,
        insuranceChaseDays: INSURANCE_CHASE_DAYS,
        recheckIntervalDays: RECHECK_INTERVAL_DAYS,
        filters: verification.QUEUE_FILTERS,
        rule: 'The badge is derived from the six published checks plus a valid insurance certificate. There is no way to award it by hand, and it comes off on its own when a check lapses.',
      },
    };
  },

  'GET /api/admin/queue': async ({ req, query }) => {
    requireAdmin(req);
    const filter = query.filter ? oneOf(query.filter, 'Filter', verification.QUEUE_FILTERS) : 'all';
    const search = str(query.q, 'Search', { max: 120 });
    return { body: verification.queue({ filter, search }) };
  },

  'GET /api/admin/renewals': async ({ req }) => {
    requireAdmin(req);
    return {
      body: {
        renewals: verification.renewalQueue(),
        chaseWindowDays: INSURANCE_CHASE_DAYS,
        note: 'A lapse should be a process failure we saw coming, not a surprise. Insurance expiries and annual re-checks appear here well before the date.',
      },
    };
  },

  'GET /api/admin/vendors/:vendorId': async ({ req, params }) => {
    requireAdmin(req);
    vendorOr404(params.vendorId);
    return { body: verification.dossier(params.vendorId) };
  },

  'POST /api/admin/vendors/:vendorId/start': async ({ req, params }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);
    return { body: { assessment: verification.startVerification(params.vendorId, actor) } };
  },

  /**
   * Record the outcome of one published check.
   */
  'POST /api/admin/vendors/:vendorId/checks/:checkKey': async ({ req, params, body }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);

    const status = oneOf(body.status, 'Outcome', ['outstanding', 'passed', 'failed', 'not_applicable']);
    const evidence = str(body.evidence, 'Evidence', { max: 2000 });

    const assessment = verification.setCheck({
      vendorId: params.vendorId,
      checkKey: params.checkKey,
      status,
      evidence,
      actor,
    });

    const vendor = get('SELECT verified FROM vendors WHERE id = ?', params.vendorId);
    return {
      body: {
        assessment,
        verified: Boolean(vendor.verified),
        note: assessment.shouldBeVerified
          ? 'Every published check is complete, so the badge has been awarded automatically.'
          : `The badge is not awarded yet. ${assessment.blockers[0]}`,
      },
    };
  },

  /**
   * Record an insurance certificate. This is how the insurance check is passed,
   * because a tick box with no expiry date would be worthless.
   */
  'POST /api/admin/vendors/:vendorId/insurance': async ({ req, params, body }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);

    const assessment = verification.recordInsurance({
      vendorId: params.vendorId,
      insurer: str(body.insurer, 'Insurer', { required: true, max: 160 }),
      policyNumber: str(body.policyNumber, 'Policy number', { max: 80 }),
      coverPence: int(body.coverPence, 'Cover', { min: 0, max: 100_000_000_00 }),
      expiresOn: isoDate(body.expiresOn, 'Expiry date'),
      indemnitySeen: bool(body.indemnitySeen),
      actor,
    });

    return {
      body: {
        assessment,
        insurance: assessment.insurance,
        note: assessment.insurance.valid
          ? `Recorded. We will start chasing the renewal ${INSURANCE_CHASE_DAYS} days before it expires.`
          : `Recorded, but it does not currently satisfy the check: ${assessment.insurance.label.toLowerCase()}.`,
      },
    };
  },

  'POST /api/admin/vendors/:vendorId/chase': async ({ req, params, body }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);
    const kind = oneOf(body.kind, 'Kind', ['insurance', 'annual_recheck'], 'insurance');
    verification.recordChase(params.vendorId, kind, str(body.note, 'Note', { max: 500 }), actor);
    return {
      body: {
        chases: verification.chasesFor(params.vendorId),
        note: 'Logged. Email delivery is not connected in this build, so send the message yourself and record what you said.',
      },
    };
  },

  /**
   * Re-derive the badge for one vendor. Useful after a date has passed.
   * It cannot force a badge on, it only reapplies the rules.
   */
  'POST /api/admin/vendors/:vendorId/recompute': async ({ req, params }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);
    const assessment = verification.recompute(params.vendorId, actor);
    const vendor = get('SELECT verified, badge_removed_reason FROM vendors WHERE id = ?', params.vendorId);
    return {
      body: {
        assessment,
        verified: Boolean(vendor.verified),
        badgeRemovedReason: vendor.badge_removed_reason || '',
      },
    };
  },

  /**
   * Suspend a vendor's badge for a reason outside the six checks, for example a
   * serious complaint under investigation. This fails a named check rather than
   * flipping a hidden flag, so the reason is always in the audit trail and the
   * badge still cannot come back until the check is put right.
   */
  'POST /api/admin/vendors/:vendorId/suspend': async ({ req, params, body }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);
    const reason = str(body.reason, 'Reason', { required: true, max: 500 });

    const assessment = verification.setCheck({
      vendorId: params.vendorId,
      checkKey: 'identity',
      status: 'failed',
      evidence: `Suspended pending review: ${reason}`,
      actor,
    });
    verification.audit(params.vendorId, 'badge.suspended', reason, actor);

    return {
      body: {
        assessment,
        note: 'The badge has been removed and the reason is on the record. Put the identity check back to passed once the review is finished.',
      },
    };
  },

  'PATCH /api/admin/vendors/:vendorId/notes': async ({ req, params, body }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);
    verification.setAdminNotes(params.vendorId, str(body.notes, 'Notes', { max: 4000 }), actor);
    return { body: { ok: true } };
  },

  'PATCH /api/admin/vendors/:vendorId/accepting': async ({ req, params, body }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);
    const accepting = bool(body.accepting);
    run('UPDATE vendors SET accepting = ? WHERE id = ?', accepting ? 1 : 0, params.vendorId);
    verification.audit(params.vendorId, accepting ? 'listing.reopened' : 'listing.paused',
      accepting ? 'Accepting enquiries again' : 'Paused, no new enquiries will be routed', actor);
    return { body: { accepting } };
  },

  'DELETE /api/admin/vendors/:vendorId/images/:uploadId': async ({ req, params }) => {
    const actor = requireAdmin(req);
    vendorOr404(params.vendorId);
    return { body: uploads.removeUpload(params.vendorId, params.uploadId, actor) };
  },

  'GET /api/admin/audit': async ({ req, query }) => {
    requireAdmin(req);
    const limit = int(query.limit, 'Limit', { min: 1, max: 200, fallback: 80 });
    const rows = all(
      `SELECT a.*, v.business_name, v.slug FROM verification_audit a
       JOIN vendors v ON v.id = a.vendor_id
       ORDER BY a.created_at DESC LIMIT ?`,
      limit
    );
    return {
      body: {
        audit: rows.map((row) => ({
          id: row.id,
          vendorId: row.vendor_id,
          vendorName: row.business_name,
          vendorSlug: row.slug,
          action: row.action,
          detail: row.detail,
          actor: row.actor_name,
          at: row.created_at,
        })),
      },
    };
  },

  'POST /api/admin/sweep': async ({ req }) => {
    requireAdmin(req);
    const result = verification.sweepBadges();
    return {
      body: {
        ...result,
        note: result.removed
          ? `${result.removed} badge${result.removed === 1 ? '' : 's'} removed because a published check is no longer satisfied.`
          : 'Every verified vendor still satisfies all six checks.',
      },
    };
  },
};
