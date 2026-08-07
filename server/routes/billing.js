'use strict';

/**
 * Real billing endpoints, live the moment Stripe keys exist. Without keys they
 * report themselves unconfigured with a 503, and the interface falls back to
 * the recorded intent mock that states plainly no payment was taken.
 */

const { get } = require('../db');
const { HttpError } = require('../lib/http');
const { requireRole } = require('../lib/auth');
const stripe = require('../lib/stripe');
const email = require('../lib/email');

function notConfigured() {
  return new HttpError(503, {
    message: 'Card payments are not switched on in this environment, so nothing can be charged. The recorded intent flow is used instead.',
    reason: 'stripe_not_configured',
    stripe: stripe.status(),
  });
}

module.exports = {
  'GET /api/billing/status': async () => ({
    body: { stripe: stripe.status(), email: email.status() },
  }),

  'POST /api/billing/vendor/checkout': async ({ req }) => {
    const user = requireRole(req, 'vendor');
    if (!stripe.configured()) throw notConfigured();
    const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
    if (!vendor) throw new HttpError(400, 'Create your listing before starting a subscription.');
    const existing = get(`SELECT id FROM subscriptions WHERE vendor_id = ? AND status = 'active'`, vendor.id);
    if (existing) throw new HttpError(409, 'This vendor already has an active subscription.');

    const founding = get(`SELECT COUNT(*) AS n FROM subscriptions WHERE plan = 'founding' AND status = 'active'`).n;
    const result = await stripe.vendorCheckout({
      vendor, user, foundingOpen: founding < 40,
    });
    return { body: { checkoutUrl: result.url, plan: result.plan, pricePence: result.pricePence } };
  },

  'POST /api/billing/couple/checkout': async ({ req }) => {
    const user = requireRole(req, 'couple');
    if (!stripe.configured()) throw notConfigured();
    const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
    if (!wedding) throw new HttpError(400, 'Start a plan before upgrading.');
    if (wedding.upgraded) throw new HttpError(409, 'This wedding is already upgraded. The upgrade is paid once.');

    const result = await stripe.coupleCheckout({ wedding, user });
    return { body: { checkoutUrl: result.url, amountPence: result.amountPence } };
  },

  /**
   * The webhook. Raw body is required for the signature, so the server routes
   * this path around the JSON parser. An unverifiable event is refused, and a
   * verified one is applied idempotently.
   */
  'POST /api/stripe/webhook': async ({ req }) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      // Stripe events are a few KB. A cap keeps a hostile peer from streaming
      // an unbounded body into memory before signature verification can refuse it.
      size += chunk.length;
      if (size > 1024 * 1024) throw new HttpError(413, 'Webhook body is too large.');
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const verdict = stripe.verifySignature(rawBody, req.headers['stripe-signature']);
    if (!verdict.ok) throw new HttpError(400, `Webhook rejected: ${verdict.reason}`);

    let event;
    try { event = JSON.parse(rawBody); } catch { throw new HttpError(400, 'Webhook body is not JSON.'); }

    const outcome = stripe.applyEvent(event);
    return { body: { received: true, ...outcome } };
  },
};
