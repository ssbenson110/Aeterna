'use strict';

/**
 * Stripe billing, ready to go live the moment keys exist.
 *
 * No SDK: Stripe's API is form-encoded HTTPS, and the webhook signature is an
 * HMAC, both of which the standard library covers. That keeps the zero
 * dependency rule intact.
 *
 * Configuration, all environment variables:
 *   STRIPE_SECRET_KEY       sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET   whsec_..., from the webhook endpoint you create
 *   APP_ORIGIN              e.g. https://aeterna.co.uk, used for redirect URLs
 *
 * Without STRIPE_SECRET_KEY every endpoint reports itself unconfigured with a
 * 503 and the interface falls back to the recorded-intent mock, stating
 * plainly that no payment was taken. Nothing pretends.
 *
 * What is created in Stripe:
 *   Vendors  a subscription in GBP with a 30 day trial (the rollout offer),
 *            price_data inline at £29 founding or £49 standard, so no manual
 *            product setup is needed before the first checkout.
 *   Couples  a one off £49 payment. Explicitly not a subscription.
 */

const crypto = require('node:crypto');
const { get, run, id, now, logEvent } = require('../db');
const { PRICING } = require('./config');

const SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const ORIGIN = process.env.APP_ORIGIN || 'http://localhost:4173';

function configured() {
  return Boolean(SECRET_KEY);
}

function status() {
  return {
    configured: configured(),
    webhookConfigured: Boolean(WEBHOOK_SECRET),
    mode: SECRET_KEY.startsWith('sk_live') ? 'live' : SECRET_KEY ? 'test' : 'off',
    note: configured()
      ? `Stripe is configured in ${SECRET_KEY.startsWith('sk_live') ? 'live' : 'test'} mode.`
      : 'STRIPE_SECRET_KEY is not set, so checkout falls back to recorded intent and no payment is taken.',
  };
}

/**
 * Stripe speaks application/x-www-form-urlencoded with bracket notation for
 * nested fields. This flattens a plain object into that shape.
 */
function encodeForm(obj, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(encodeForm(value, name));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        parts.push(typeof item === 'object' ? encodeForm(item, `${name}[${index}]`)
          : `${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(item)}`);
      });
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripeRequest(path, params) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data.error && data.error.message) || `Stripe returned ${response.status}`;
    const error = new Error(message);
    error.stripe = true;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* checkout                                                            */
/* ------------------------------------------------------------------ */

async function vendorCheckout({ vendor, user, foundingOpen }) {
  const price = foundingOpen ? PRICING.vendor.foundingPricePence : PRICING.vendor.standardPricePence;
  const plan = foundingOpen ? 'founding' : 'standard';

  const session = await stripeRequest('/v1/checkout/sessions', {
    mode: 'subscription',
    customer_email: user.email,
    client_reference_id: vendor.id,
    'line_items[0]': {
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: price,
        recurring: { interval: 'month' },
        product_data: {
          name: `AETERNA vendor plan, ${plan} rate`,
          description: 'One flat monthly fee. No paid ranking, ever.',
        },
      },
    },
    subscription_data: {
      trial_period_days: PRICING.vendor.trialDays,
      metadata: { vendorId: vendor.id, plan },
    },
    metadata: { kind: 'vendor_subscription', vendorId: vendor.id, plan },
    success_url: `${ORIGIN}/#/account?billing=success`,
    cancel_url: `${ORIGIN}/#/account?billing=cancelled`,
  });

  logEvent('stripe.checkout_created', vendor.id, { kind: 'vendor', plan });
  return { url: session.url, sessionId: session.id, plan, pricePence: price };
}

async function coupleCheckout({ wedding, user }) {
  const session = await stripeRequest('/v1/checkout/sessions', {
    mode: 'payment',
    customer_email: user.email,
    client_reference_id: wedding.id,
    'line_items[0]': {
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: PRICING.couple.upgradePricePence,
        product_data: {
          name: 'AETERNA wedding upgrade',
          description: 'Paid once for this wedding. Not a subscription, it will never renew.',
        },
      },
    },
    metadata: { kind: 'couple_upgrade', weddingId: wedding.id },
    success_url: `${ORIGIN}/#/planner?billing=success`,
    cancel_url: `${ORIGIN}/#/pricing?billing=cancelled`,
  });

  logEvent('stripe.checkout_created', wedding.id, { kind: 'couple' });
  return { url: session.url, sessionId: session.id, amountPence: PRICING.couple.upgradePricePence };
}

/* ------------------------------------------------------------------ */
/* webhooks                                                            */
/* ------------------------------------------------------------------ */

/**
 * Verify Stripe's signature header: t=timestamp,v1=hmac. The HMAC is
 * SHA256(`${t}.${rawBody}`) with the webhook secret. Constant time compare,
 * and a five minute tolerance against replays.
 */
function verifySignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return { ok: false, reason: 'STRIPE_WEBHOOK_SECRET is not set.' };
  if (!signatureHeader) return { ok: false, reason: 'No signature header.' };

  const parts = Object.fromEntries(
    String(signatureHeader).split(',').map((p) => p.split('=').map((x) => x.trim()))
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature) return { ok: false, reason: 'Malformed signature header.' };
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return { ok: false, reason: 'Signature timestamp outside tolerance.' };

  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature mismatch.' };
  }
  return { ok: true };
}

/**
 * Apply a verified event. Idempotent: replaying an event changes nothing.
 */
function applyEvent(event) {
  const type = event.type;
  const object = (event.data && event.data.object) || {};

  if (type === 'checkout.session.completed') {
    const kind = (object.metadata || {}).kind;

    if (kind === 'couple_upgrade') {
      const weddingId = object.metadata.weddingId || object.client_reference_id;
      const wedding = get('SELECT * FROM weddings WHERE id = ?', weddingId);
      if (!wedding) return { handled: false, reason: 'Unknown wedding.' };
      if (!wedding.upgraded) {
        run('UPDATE weddings SET upgraded = 1, updated_at = ? WHERE id = ?', now(), weddingId);
        run('INSERT INTO couple_upgrades (id, wedding_id, amount_pence, status, created_at) VALUES (?,?,?,?,?)',
          id('upg'), weddingId, object.amount_total || PRICING.couple.upgradePricePence, 'paid', now());
      }
      logEvent('stripe.couple_upgraded', weddingId, {});
      return { handled: true };
    }

    if (kind === 'vendor_subscription') {
      const vendorId = object.metadata.vendorId || object.client_reference_id;
      const vendor = get('SELECT * FROM vendors WHERE id = ?', vendorId);
      if (!vendor) return { handled: false, reason: 'Unknown vendor.' };
      const existing = get(`SELECT id FROM subscriptions WHERE vendor_id = ? AND status = 'active'`, vendorId);
      if (!existing) {
        const plan = object.metadata.plan === 'standard' ? 'standard' : 'founding';
        const price = plan === 'founding' ? PRICING.vendor.foundingPricePence : PRICING.vendor.standardPricePence;
        run(
          `INSERT INTO subscriptions (id, vendor_id, plan, price_pence, status, started_at, rate_locked_until, trial_until)
           VALUES (?,?,?,?,?,?,?,?)`,
          id('sub'), vendorId, plan, price, 'active', now(),
          plan === 'founding' ? new Date(Date.now() + PRICING.vendor.foundingLockMonths * 30.44 * 864e5).toISOString() : null,
          new Date(Date.now() + PRICING.vendor.trialDays * 864e5).toISOString()
        );
      }
      logEvent('stripe.vendor_subscribed', vendorId, {});
      return { handled: true };
    }
    return { handled: false, reason: 'Unknown checkout kind.' };
  }

  if (type === 'customer.subscription.deleted') {
    const vendorId = (object.metadata || {}).vendorId;
    if (vendorId) {
      run(`UPDATE subscriptions SET status = 'cancelled' WHERE vendor_id = ? AND status = 'active'`, vendorId);
      // A lapsed subscription stops enquiries without deleting anything.
      run('UPDATE vendors SET accepting = 0 WHERE id = ?', vendorId);
      logEvent('stripe.vendor_cancelled', vendorId, {});
      return { handled: true };
    }
    return { handled: false, reason: 'No vendor on the subscription.' };
  }

  // Everything else is acknowledged and ignored, which is what Stripe expects.
  return { handled: false, reason: `Ignored event type ${type}.` };
}

module.exports = { configured, status, vendorCheckout, coupleCheckout, verifySignature, applyEvent };
