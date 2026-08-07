'use strict';

/**
 * Seed data.
 *
 * IMPORTANT: every vendor created here carries is_sample = 1 and the interface
 * labels them as sample listings. They exist so the product is legible before
 * real vendors sign up. There are no reviews, no ratings, no testimonials and no
 * counts of couples served anywhere in this file, because none of that exists yet.
 */

const { all, get, run, id, now, logEvent } = require('../db');
const { hashPassword } = require('./auth');
const images = require('./images');
const { CHECKLIST_TEMPLATE, BUDGET_TEMPLATE, TIMELINE_TEMPLATE } = require('./templates');
const { SAMPLE_VENDORS } = require('./seed-vendors');
const workspace = require('./workspace');
const verification = require('./verification');

function seedIfEmpty() {
  const existing = get('SELECT COUNT(*) AS n FROM vendors');
  if (existing && existing.n > 0) return { skipped: true, vendors: existing.n };

  const created = now();

  for (const spec of SAMPLE_VENDORS) {
    const vendorId = id('ven');
    const heroImage = images.categoryTiles[spec.hero];

    run(
      `INSERT INTO vendors
        (id, user_id, slug, business_name, category, region, town, tagline, about,
         price_from_pence, price_unit, hero_image, hero_alt, verified, verified_at,
         verification_ref, capacity_per_month, accepting, is_sample, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      vendorId, null, spec.slug, spec.business_name, spec.category, spec.region, spec.town,
      spec.tagline, spec.about, spec.price_from_pence, spec.price_unit || 'from',
      spec.headshot !== undefined ? images.headshots[spec.headshot].url : heroImage.url,
      spec.headshot !== undefined ? images.headshots[spec.headshot].alt : heroImage.alt,
      spec.verified, spec.verified ? created : null,
      spec.verified ? 'scope-1.0' : null,
      spec.capacity_per_month, 1, 1, created
    );

    const gallery = (spec.portfolio || []).map((i) => images.portfolio[i]).filter(Boolean);
    if (!gallery.length) gallery.push(heroImage);
    gallery.unshift(heroImage);
    gallery.forEach((img, index) => {
      run('INSERT INTO vendor_images (id, vendor_id, url, alt, sort) VALUES (?,?,?,?,?)',
        id('vim'), vendorId, img.url, img.alt, index);
    });

    for (const tradition of spec.traditions || []) {
      run('INSERT OR IGNORE INTO vendor_traditions (vendor_id, tradition) VALUES (?,?)', vendorId, tradition);
    }
    (spec.services || []).forEach((label, index) => {
      run('INSERT INTO vendor_services (vendor_id, label, sort) VALUES (?,?,?)', vendorId, label, index);
    });

    // Every sample vendor is on the founding rate, which is what a real early
    // vendor would be on. No vendor record carries a ranking or payment weighting.
    run(
      `INSERT INTO subscriptions (id, vendor_id, plan, price_pence, status, started_at, rate_locked_until)
       VALUES (?,?,?,?,?,?,?)`,
      id('sub'), vendorId, 'founding', 2900, 'active', created,
      new Date(Date.now() + 365 * 864e5).toISOString()
    );
  }

  // A badge with no checks behind it would be exactly the thing this product
  // says it does not do, so every seeded vendor gets real records. The verified
  // ones get all six passed plus a certificate; the rest are left part done so
  // the console has a realistic queue to work through.
  seedVerificationRecords();

  logEvent('seed.completed', 'vendors', { count: SAMPLE_VENDORS.length });
  return { skipped: false, vendors: SAMPLE_VENDORS.length };
}

/**
 * Give the seeded vendors verification state that matches their badge.
 *
 * The seeded "verified" vendors are set up as though our team completed the six
 * checks, because otherwise the badge would be an unsupported claim, which is
 * the one thing the published scope forbids. The unverified ones are left at
 * various stages so the console opens onto a realistic queue.
 */
function seedVerificationRecords() {
  const staff = { id: null, display_name: 'AETERNA verification team' };
  const vendors = all('SELECT * FROM vendors ORDER BY created_at');
  const stamp = now();

  vendors.forEach((vendor, index) => {
    verification.ensureChecks(vendor.id);

    if (vendor.verified) {
      // Clear the seeded flag first, so the badge is genuinely re-derived from
      // the records below rather than simply left as it was.
      run(`UPDATE vendors SET verified = 0, verified_at = NULL WHERE id = ?`, vendor.id);
      run('UPDATE vendors SET verification_started_at = ? WHERE id = ?', stamp, vendor.id);

      for (const key of ['identity', 'references', 'video_call']) {
        run(
          `UPDATE verification_checks SET status = 'passed', evidence = ?, completed_at = ?, updated_at = ?
           WHERE vendor_id = ? AND check_key = ?`,
          seedEvidence(key, vendor), stamp, stamp, vendor.id, key
        );
      }
      run(
        `UPDATE verification_checks SET status = 'passed', evidence = ?, completed_at = ?, updated_at = ?
         WHERE vendor_id = ? AND check_key = 'portfolio_rights'`,
        'Confirmed in writing by the vendor during onboarding', stamp, stamp, vendor.id
      );
      run('UPDATE vendors SET rights_confirmed_at = ? WHERE id = ?', stamp, vendor.id);

      // Stagger expiries so the renewals queue is not uniformly comfortable.
      // Every third one lands inside the chase window on purpose.
      const monthsOut = index % 3 === 0 ? 1 : 8 + (index % 5);
      const expires = new Date(Date.now() + monthsOut * 30.44 * 864e5).toISOString().slice(0, 10);
      run(
        `INSERT INTO insurance_records
          (id, vendor_id, insurer, policy_number, cover_type, cover_pence, expires_on,
           sighted_at, sighted_by, indemnity_seen, superseded, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id('ins'), vendor.id, SEED_INSURERS[index % SEED_INSURERS.length],
        `PL-${String(100000 + index * 7)}`, 'public_liability', 500000000, expires,
        stamp.slice(0, 10), null, 1, 0, stamp
      );
      run(
        `UPDATE verification_checks SET status = 'passed', evidence = ?, completed_at = ?, updated_at = ?
         WHERE vendor_id = ? AND check_key = 'insurance'`,
        `${SEED_INSURERS[index % SEED_INSURERS.length]}, expires ${expires}`, stamp, stamp, vendor.id
      );

      // Now let the rules decide, which is the only way a badge is ever set.
      verification.recompute(vendor.id, staff);
    } else if (index % 2 === 0) {
      // Part way through, so the queue has work in it.
      run('UPDATE vendors SET verification_started_at = ? WHERE id = ?', stamp, vendor.id);
      run(
        `UPDATE verification_checks SET status = 'passed', evidence = ?, completed_at = ?, updated_at = ?
         WHERE vendor_id = ? AND check_key = 'identity'`,
        seedEvidence('identity', vendor), stamp, stamp, vendor.id
      );
    }
  });
}

const SEED_INSURERS = ['Hiscox', 'Simply Business', 'AXA', 'Zurich', 'Direct Line for Business'];

function seedEvidence(key, vendor) {
  if (key === 'identity') {
    return vendor.is_sample
      ? 'Companies House number sighted during onboarding'
      : 'Photo identification sighted';
  }
  if (key === 'references') return 'Two recent clients and one industry contact contacted. Comments not recorded, they are not reviews.';
  if (key === 'video_call') return 'Video call completed with the named owner of the business';
  return '';
}

/**
 * Build the starter plan for a wedding: checklist, budget lines and a day timeline.
 */
function seedWeddingPlan(weddingId, budgetPence) {
  CHECKLIST_TEMPLATE.forEach((item, index) => {
    run(
      'INSERT INTO checklist_items (id, wedding_id, title, phase, detail, done, sort, custom) VALUES (?,?,?,?,?,?,?,?)',
      id('chk'), weddingId, item.title, item.phase, item.detail || '', 0, index, 0
    );
  });

  BUDGET_TEMPLATE.forEach((line, index) => {
    run(
      'INSERT INTO budget_lines (id, wedding_id, category, planned_pence, actual_pence, paid, sort) VALUES (?,?,?,?,?,?,?)',
      id('bud'), weddingId, line.category,
      budgetPence ? Math.round(budgetPence * line.share) : 0, 0, 0, index
    );
  });

  TIMELINE_TEMPLATE.forEach((event) => {
    run(
      'INSERT INTO timeline_events (id, wedding_id, at_time, title, detail, owner) VALUES (?,?,?,?,?,?)',
      id('tml'), weddingId, event.at_time, event.title, event.detail || '', event.owner || ''
    );
  });

  ['Top table', 'Table 1', 'Table 2', 'Table 3'].forEach((name, index) => {
    run('INSERT INTO seating_tables (id, wedding_id, name, capacity, sort) VALUES (?,?,?,?,?)',
      id('tbl'), weddingId, name, index === 0 ? 6 : 8, index);
  });
}

/**
 * Optional demo couple so the planner and chat can be explored immediately.
 * Created only when AETERNA_DEMO=1.
 */
function seedDemoCouple() {
  const email = 'demo@aeterna.co.uk';
  if (get('SELECT id FROM users WHERE email = ?', email)) return { skipped: true };

  const userId = id('usr');
  const created = now();
  run('INSERT INTO users (id, email, password_hash, role, display_name, created_at) VALUES (?,?,?,?,?,?)',
    userId, email, hashPassword('planmywedding'), 'couple', 'Demo couple', created);

  const weddingId = id('wed');
  const date = new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10);
  run(
    `INSERT INTO weddings (id, user_id, partner_one, partner_two, wedding_date, budget_pence,
      guest_count, region, traditions, notes, upgraded, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    weddingId, userId, 'Priya', 'Daniel', date, 2400000, 140, 'South London',
    JSON.stringify(['Hindu ceremony', 'Civil ceremony']),
    'Two ceremonies, one weekend. Both families are travelling in.',
    0, created, created
  );
  seedWeddingPlan(weddingId, 2400000);
  workspace.ensureOwner(
    get('SELECT * FROM weddings WHERE id = ?', weddingId),
    get('SELECT * FROM users WHERE id = ?', userId)
  );
  return { skipped: false, email, weddingId };
}

/**
 * A staff account for the verification console. Demo mode only.
 */
function seedAdmin() {
  const email = 'admin@aeterna.co.uk';
  if (get('SELECT id FROM users WHERE email = ?', email)) return { skipped: true };
  run('INSERT INTO users (id, email, password_hash, role, display_name, created_at) VALUES (?,?,?,?,?,?)',
    id('usr'), email, hashPassword('verify-the-checks'), 'admin', 'AETERNA verification team', now());
  return { skipped: false, email };
}

module.exports = { seedIfEmpty, seedWeddingPlan, seedDemoCouple, seedAdmin, SAMPLE_VENDORS };
