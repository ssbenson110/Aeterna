'use strict';

/**
 * The exclusive enquiry router.
 *
 * Product promise: one enquiry goes to exactly one vendor, never a bidding swarm,
 * and a vendor's position is never influenced by money. This module is the only
 * place a vendor is chosen, so the promise is enforceable in one file.
 *
 * Ranking inputs, in order of weight:
 *   1. Hard filters   category, accepting enquiries, monthly capacity, not already tried
 *   2. Region fit     exact region, then the wider beachhead area
 *   3. Tradition fit  vendors who have logged experience with the couple's traditions
 *   4. Budget fit     the vendor's from price sits inside the couple's category allowance
 *   5. Fairness       least recently routed vendor wins, so rotation stays even
 *
 * There is deliberately no paid weighting. There is no field a vendor can buy.
 */

const { all, get, run, id, now, logEvent } = require('../db');
const {
  ENQUIRY_EXCLUSIVITY_HOURS, CATEGORY_BUDGET_SHARE, REGION_GROUPS, REGION_GROUP_NEIGHBOURS,
} = require('./config');

/* Region -> group lookup, built once. */
const GROUP_OF = {};
for (const group of REGION_GROUPS) {
  for (const region of group.items) GROUP_OF[region] = group.label;
}

/**
 * How well a vendor's region fits the couple's, now that the map is the whole
 * UK. Same area beats same group beats a neighbouring group; anything further
 * is a last resort rather than a match.
 */
function regionScore(vendorRegion, coupleRegion) {
  if (vendorRegion === coupleRegion) {
    return { score: 50, reason: `covers ${coupleRegion}` };
  }
  const vendorGroup = GROUP_OF[vendorRegion];
  const coupleGroup = GROUP_OF[coupleRegion];
  if (vendorGroup && vendorGroup === coupleGroup) {
    return { score: 28, reason: `covers the wider ${coupleGroup} area from ${vendorRegion}` };
  }
  if (vendorGroup && coupleGroup && (REGION_GROUP_NEIGHBOURS[coupleGroup] || []).includes(vendorGroup)) {
    return { score: 12, reason: `travels into ${coupleGroup} from ${vendorRegion}` };
  }
  return { score: 1, reason: null };
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function monthlyLoad(vendorId) {
  const row = get(
    `SELECT COUNT(*) AS n FROM enquiries
     WHERE vendor_id = ? AND substr(created_at, 1, 7) = ?
       AND status IN ('awaiting_vendor','accepted')`,
    vendorId, monthKey()
  );
  return row ? row.n : 0;
}

function traditionsFor(vendorId) {
  return all('SELECT tradition FROM vendor_traditions WHERE vendor_id = ?', vendorId)
    .map((r) => r.tradition);
}

/**
 * Traditions a couple has recorded, presets and their own free text together.
 * A custom tradition is matched exactly like a preset, so a couple who typed
 * something we had not thought of is not quietly deprioritised.
 */
function weddingTraditions(wedding) {
  return safeJson(wedding.traditions, []).concat(safeJson(wedding.custom_traditions, []));
}

/**
 * Loose comparison so "Yoruba traditional" typed by a couple matches a vendor
 * who logged "Yoruba Traditional" or "yoruba".
 */
function traditionMatches(a, b) {
  const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Score and pick a single vendor. Returns { vendor, reason, considered } or null.
 */
function pickVendor({ category, region, traditions = [], budgetPence = 0, exclude = [], weddingDate = null }) {
  const candidates = all(
    'SELECT * FROM vendors WHERE category = ? AND accepting = 1',
    category
  ).filter((v) => !exclude.includes(v.id));

  const allowance = Math.round((budgetPence || 0) * (CATEGORY_BUDGET_SHARE[category] || 0.08));

  const scored = [];
  for (const vendor of candidates) {
    const load = monthlyLoad(vendor.id);
    if (load >= vendor.capacity_per_month) continue; // at capacity this month

    // A date the vendor has blocked out never receives an enquiry it would
    // only have to decline. Their calendar is a hard filter, not a score.
    if (weddingDate && get(
      'SELECT id FROM vendor_blackouts WHERE vendor_id = ? AND on_date = ?',
      vendor.id, weddingDate
    )) continue;

    let score = 0;
    const reasons = [];

    const fit = regionScore(vendor.region, region);
    score += fit.score;
    if (fit.reason) reasons.push(fit.reason);

    if (vendor.verified) {
      score += 20;
      reasons.push('is AETERNA Verified');
    }

    const vendorTraditions = traditionsFor(vendor.id);
    const matched = traditions.filter((t) => vendorTraditions.some((vt) => traditionMatches(t, vt)));
    if (matched.length) {
      score += 15 * Math.min(matched.length, 2);
      reasons.push(`has logged experience with ${matched.slice(0, 2).join(' and ')}`);
    }

    if (allowance > 0 && vendor.price_from_pence > 0) {
      if (vendor.price_from_pence <= allowance) {
        score += 15;
        reasons.push('starts inside your budget for this category');
      } else if (vendor.price_from_pence <= allowance * 1.25) {
        score += 5;
        reasons.push('starts a little above your category allowance');
      } else {
        score -= 20;
      }
    }

    // Fairness. The longer a vendor has gone without an enquiry, the higher they rise.
    const lastRouted = vendor.last_routed_at ? new Date(vendor.last_routed_at).getTime() : 0;
    const daysIdle = lastRouted ? (Date.now() - lastRouted) / 864e5 : 90;
    score += Math.min(daysIdle, 60) * 0.5;

    // Spread load inside the month.
    score -= load * 4;

    scored.push({ vendor, score, reasons });
  }

  if (!scored.length) return null;

  scored.sort((a, b) => b.score - a.score || a.vendor.business_name.localeCompare(b.vendor.business_name));
  const winner = scored[0];

  const reason = winner.reasons.length
    ? `Routed to ${winner.vendor.business_name} because it ${winner.reasons.join(', ')}.`
    : `Routed to ${winner.vendor.business_name} as the next available match.`;

  return { vendor: winner.vendor, reason, considered: scored.length };
}

function makeReference() {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AE-${stamp}-${tail}`;
}

/**
 * Create an enquiry and route it to exactly one vendor.
 */
function createEnquiry({ wedding, coupleUserId, category, message, preferredVendorId = null }) {
  const traditions = weddingTraditions(wedding);

  let pick = null;
  if (preferredVendorId) {
    const vendor = get('SELECT * FROM vendors WHERE id = ? AND accepting = 1', preferredVendorId);
    if (vendor && monthlyLoad(vendor.id) < vendor.capacity_per_month) {
      pick = { vendor, reason: `Sent directly to ${vendor.business_name} because you asked for them by name.`, considered: 1 };
    }
  }
  if (!pick) {
    pick = pickVendor({
      category,
      region: wedding.region,
      traditions,
      budgetPence: wedding.budget_pence,
      weddingDate: wedding.wedding_date,
    });
  }
  if (!pick) return { ok: false, reason: 'no_match' };

  const enquiryId = id('enq');
  const created = now();
  const exclusiveUntil = new Date(Date.now() + ENQUIRY_EXCLUSIVITY_HOURS * 3600_000).toISOString();

  run(
    `INSERT INTO enquiries
      (id, reference, wedding_id, couple_user_id, vendor_id, category, message, status,
       exclusive_until, routed_reason, attempt, previous_vendors, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    enquiryId, makeReference(), wedding.id, coupleUserId, pick.vendor.id, category,
    message || '', 'awaiting_vendor', exclusiveUntil, pick.reason, 1, '[]', created
  );

  run('UPDATE vendors SET last_routed_at = ? WHERE id = ?', created, pick.vendor.id);
  logEvent('enquiry.routed', enquiryId, {
    vendorId: pick.vendor.id, category, considered: pick.considered, attempt: 1,
  });

  // Tell the vendor. Exclusivity is only worth something if they hear about
  // the enquiry while it is still theirs alone.
  notifyVendor(pick.vendor.id, {
    subject: 'A new enquiry is waiting for you, and only you',
    bodyText: `An enquiry for a ${wedding.region} wedding${wedding.wedding_date ? ` on ${wedding.wedding_date}` : ''} has been routed to you alone. You have ${ENQUIRY_EXCLUSIVITY_HOURS} hours before it moves on to one other vendor.\n\nNobody else received it, and nobody is bidding against you.`,
    ctaLabel: 'Open your dashboard',
  });

  return { ok: true, enquiryId, vendor: pick.vendor, reason: pick.reason, considered: pick.considered };
}

/**
 * A vendor declined or let the window lapse. Move the enquiry to the next single
 * vendor. It is still one vendor at a time, never a broadcast.
 */
function rerouteEnquiry(enquiryId) {
  const enquiry = get('SELECT * FROM enquiries WHERE id = ?', enquiryId);
  if (!enquiry) return { ok: false, reason: 'not_found' };

  const wedding = get('SELECT * FROM weddings WHERE id = ?', enquiry.wedding_id);
  if (!wedding) return { ok: false, reason: 'not_found' };

  const previous = safeJson(enquiry.previous_vendors, []);
  previous.push(enquiry.vendor_id);

  const pick = pickVendor({
    category: enquiry.category,
    region: wedding.region,
    traditions: weddingTraditions(wedding),
    budgetPence: wedding.budget_pence,
    exclude: previous,
  });

  if (!pick) {
    run(`UPDATE enquiries SET status = 'no_match', responded_at = ? WHERE id = ?`, now(), enquiryId);
    logEvent('enquiry.exhausted', enquiryId, { attempts: enquiry.attempt });
    return { ok: false, reason: 'no_match' };
  }

  const stamp = now();
  run(
    `UPDATE enquiries
       SET vendor_id = ?, status = 'awaiting_vendor', attempt = ?, previous_vendors = ?,
           routed_reason = ?, exclusive_until = ?, responded_at = NULL
     WHERE id = ?`,
    pick.vendor.id,
    enquiry.attempt + 1,
    JSON.stringify(previous),
    pick.reason,
    new Date(Date.now() + ENQUIRY_EXCLUSIVITY_HOURS * 3600_000).toISOString(),
    enquiryId
  );
  run('UPDATE vendors SET last_routed_at = ? WHERE id = ?', stamp, pick.vendor.id);
  logEvent('enquiry.rerouted', enquiryId, { vendorId: pick.vendor.id, attempt: enquiry.attempt + 1 });

  return { ok: true, vendor: pick.vendor, reason: pick.reason, attempt: enquiry.attempt + 1 };
}

/**
 * Expire enquiries whose exclusive window has passed with no vendor response,
 * then hand each one to the next single vendor.
 */
function sweepExpired() {
  const stale = all(
    `SELECT id FROM enquiries WHERE status = 'awaiting_vendor' AND exclusive_until < ?`,
    now()
  );
  let moved = 0;
  for (const row of stale) {
    const result = rerouteEnquiry(row.id);
    if (result.ok) moved += 1;
  }
  return { checked: stale.length, moved };
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fire and forget email to the person behind a vendor. Failure never affects
 * the request that triggered it.
 */
function notifyVendor(vendorId, message) {
  try {
    const vendor = get('SELECT * FROM vendors WHERE id = ?', vendorId);
    if (!vendor || !vendor.user_id) return;
    const owner = get('SELECT email FROM users WHERE id = ?', vendor.user_id);
    if (!owner) return;
    const origin = process.env.APP_ORIGIN || 'http://localhost:4173';
    require('./email').send({
      to: owner.email,
      subject: message.subject,
      bodyText: message.bodyText,
      ctaLabel: message.ctaLabel || 'Open AETERNA',
      ctaUrl: `${origin}/#/account`,
    }).catch(() => {});
  } catch { /* never let email break routing */ }
}

module.exports = {
  pickVendor, createEnquiry, rerouteEnquiry, sweepExpired,
  monthlyLoad, safeJson, weddingTraditions, traditionMatches, notifyVendor,
};
