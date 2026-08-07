'use strict';

/**
 * Vendor side: image uploads, the rights confirmation that gates them, and a
 * read only view of the vendor's own verification progress.
 *
 * A vendor can see exactly which of the six checks are outstanding, because
 * being told "verification in progress" with no detail is useless. What they
 * cannot do is change any of them.
 */

const { get, run, now } = require('../db');
const { HttpError, str, bool } = require('../lib/http');
const { requireRole } = require('../lib/auth');
const uploads = require('../lib/uploads');
const verification = require('../lib/verification');
const { UPLOADS } = require('../lib/config');

function myVendor(req) {
  const user = requireRole(req, 'vendor');
  const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
  if (!vendor) throw new HttpError(404, 'Create your listing first.');
  return { user, vendor };
}

module.exports = {
  /**
   * The vendor's own verification state, in plain terms.
   */
  'GET /api/vendors/me/verification': async ({ req }) => {
    const { vendor } = myVendor(req);
    const assessment = verification.assess(vendor.id);

    return {
      body: {
        verified: Boolean(vendor.verified),
        badgeRemovedReason: vendor.badge_removed_reason || '',
        completed: assessment.completed,
        total: assessment.total,
        recheckDueOn: assessment.recheckDueOn,
        rightsConfirmedAt: vendor.rights_confirmed_at,
        rightsStatement: UPLOADS.rightsStatement,
        // What the vendor themselves can act on, separated from what we do.
        checks: assessment.checks.map((check) => ({
          key: check.key,
          label: check.label,
          status: check.status,
          yoursToDo: check.key === 'portfolio_rights',
          waitingOnUs: check.key !== 'portfolio_rights' && check.status === 'outstanding',
        })),
        insurance: {
          status: assessment.insurance.status,
          label: assessment.insurance.label,
          expiresOn: assessment.insurance.expiresOn || null,
          indemnityRequired: assessment.insurance.indemnityRequired,
        },
        note: 'AETERNA Verified is a set of checks our team completes. You cannot switch it on, and neither can we without completing them.',
      },
    };
  },

  /**
   * The written rights confirmation. Required before any upload is accepted.
   */
  'POST /api/vendors/me/rights': async ({ req, body }) => {
    const { user, vendor } = myVendor(req);
    if (!bool(body.confirmed)) {
      throw new HttpError(400, 'We need an explicit confirmation, so please tick the box.');
    }
    if (str(body.statement, 'Statement', { max: 500 }) !== UPLOADS.rightsStatement) {
      throw new HttpError(400, 'The confirmation wording did not match what was shown. Please reload and try again.');
    }
    verification.confirmRights(vendor.id, user);
    return {
      body: {
        confirmedAt: now(),
        note: 'Recorded. That completes the portfolio rights check, and you can now upload images.',
      },
    };
  },

  'GET /api/vendors/me/images': async ({ req }) => {
    const { vendor } = myVendor(req);
    return {
      body: {
        images: uploads.listUploads(vendor.id),
        maxImages: UPLOADS.maxImagesPerVendor,
        maxBytes: UPLOADS.maxBytes,
        accepts: Object.keys(UPLOADS.allowed),
        rightsConfirmed: Boolean(vendor.rights_confirmed_at),
      },
    };
  },

  /**
   * Raw image bytes as the body, alt text as a query parameter.
   * Deliberately not multipart: there is no dependency to parse it with, and a
   * raw body has no boundary handling to get wrong.
   */
  'POST /api/vendors/me/images': async ({ req, query }) => {
    const { user, vendor } = myVendor(req);
    const result = await uploads.acceptUpload({
      req,
      vendor,
      alt: query.alt,
      makeHero: query.hero === '1',
      actor: user,
    });
    return { status: 201, body: { image: result, images: uploads.listUploads(vendor.id) } };
  },

  'PATCH /api/vendors/me/images/:uploadId': async ({ req, params, body }) => {
    const { user, vendor } = myVendor(req);
    if (body.alt !== undefined) uploads.setAlt(vendor.id, params.uploadId, body.alt, user);
    if (bool(body.isHero)) uploads.makeHero(vendor.id, params.uploadId);
    return { body: { images: uploads.listUploads(vendor.id) } };
  },

  'DELETE /api/vendors/me/images/:uploadId': async ({ req, params }) => {
    const { user, vendor } = myVendor(req);
    const result = uploads.removeUpload(vendor.id, params.uploadId, user);
    return { body: { ...result, images: uploads.listUploads(vendor.id) } };
  },
};
