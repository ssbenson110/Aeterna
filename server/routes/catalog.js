'use strict';

const { all, get, run, id, now } = require('../db');
const { HttpError, str, int, oneOf } = require('../lib/http');
const {
  PRICING, CATEGORIES, CATEGORY_FAMILIES, REGIONS, REGION_GROUPS, TRADITIONS, TRADITION_GROUPS,
  VERIFICATION_SCOPE, FAIR_USE, MAX_CUSTOM_TRADITION_LENGTH, WORKSPACE_ROLES, TABLE_SHAPES,
} = require('../lib/config');
const ai = require('../lib/planner-ai');
const { requireUser, requireRole } = require('../lib/auth');
const images = require('../lib/images');
const crm = require('../lib/crm');

function shapeVendor(row, { full = false } = {}) {
  const base = {
    id: row.id,
    slug: row.slug,
    businessName: row.business_name,
    category: row.category,
    categoryLabel: (CATEGORIES.find((c) => c.slug === row.category) || {}).label || row.category,
    region: row.region,
    town: row.town,
    tagline: row.tagline,
    priceFromPence: row.price_from_pence,
    heroImage: row.hero_image,
    heroAlt: row.hero_alt,
    verified: Boolean(row.verified),
    verifiedAt: row.verified_at,
    accepting: Boolean(row.accepting),
    isSample: Boolean(row.is_sample),
  };
  if (!full) return base;

  return {
    ...base,
    about: row.about,
    capacityPerMonth: row.capacity_per_month,
    traditions: all('SELECT tradition FROM vendor_traditions WHERE vendor_id = ?', row.id).map((r) => r.tradition),
    services: all('SELECT label FROM vendor_services WHERE vendor_id = ? ORDER BY sort', row.id).map((r) => r.label),
    gallery: all('SELECT url, alt FROM vendor_images WHERE vendor_id = ? ORDER BY sort', row.id),
  };
}

function foundingStatus() {
  const row = get(`SELECT COUNT(*) AS n FROM subscriptions WHERE plan = 'founding' AND status = 'active'`);
  const taken = row ? row.n : 0;
  const remaining = Math.max(0, PRICING.vendor.foundingSlots - taken);
  return {
    slots: PRICING.vendor.foundingSlots,
    remaining,
    open: remaining > 0,
    currentPricePence: remaining > 0 ? PRICING.vendor.foundingPricePence : PRICING.vendor.standardPricePence,
  };
}

module.exports = {
  'GET /api/meta': async () => ({
    body: {
      categories: CATEGORIES,
      categoryFamilies: CATEGORY_FAMILIES,
      regions: REGIONS,
      regionGroups: REGION_GROUPS,
      tableShapes: TABLE_SHAPES,
      traditions: TRADITIONS,
      traditionGroups: TRADITION_GROUPS,
      maxCustomTraditionLength: MAX_CUSTOM_TRADITION_LENGTH,
      workspaceRoles: WORKSPACE_ROLES,
      aiStatus: ai.status(),
      pricing: PRICING,
      images: { hero: images.hero, couples: images.couples, categoryTiles: images.categoryTiles },
    },
  }),

  'GET /api/pricing': async () => ({
    body: {
      vendor: {
        ...PRICING.vendor,
        founding: foundingStatus(),
      },
      couple: PRICING.couple,
    },
  }),

  'GET /api/policies/verification': async () => ({ body: VERIFICATION_SCOPE }),

  'GET /api/policies/fair-use': async () => ({ body: FAIR_USE }),

  'GET /api/vendors': async ({ query }) => {
    const category = query.category ? oneOf(query.category, 'Category', CATEGORIES.map((c) => c.slug)) : null;
    const region = query.region ? str(query.region, 'Region', { max: 60 }) : null;
    const tradition = query.tradition ? str(query.tradition, 'Tradition', { max: 60 }) : null;
    const term = str(query.q, 'Search', { max: 120 });
    const maxPrice = int(query.maxPricePence, 'Maximum price', { min: 0, max: 100_000_00, fallback: 0 });
    const limit = int(query.limit, 'Limit', { min: 1, max: 60, fallback: 24 });
    const offset = int(query.offset, 'Offset', { min: 0, max: 10_000, fallback: 0 });

    const clauses = ['1 = 1'];
    const params = [];
    if (category) { clauses.push('category = ?'); params.push(category); }
    if (region) { clauses.push('region = ?'); params.push(region); }
    if (maxPrice) { clauses.push('price_from_pence <= ?'); params.push(maxPrice); }
    if (term) {
      clauses.push('(lower(business_name) LIKE ? OR lower(tagline) LIKE ? OR lower(about) LIKE ? OR lower(town) LIKE ?)');
      const like = `%${term.toLowerCase()}%`;
      params.push(like, like, like, like);
    }
    if (tradition) {
      // Loose both ways: a search for "yoruba" finds a vendor who logged
      // "Yoruba traditional", and a search for "Yoruba traditional wedding"
      // still finds a vendor who logged "Yoruba".
      clauses.push(`id IN (
        SELECT vendor_id FROM vendor_traditions
        WHERE lower(tradition) LIKE ? OR ? LIKE '%' || lower(tradition) || '%'
      )`);
      params.push(`%${tradition.toLowerCase()}%`, tradition.toLowerCase());
    }

    const where = clauses.join(' AND ');
    const total = get(`SELECT COUNT(*) AS n FROM vendors WHERE ${where}`, ...params).n;
    // Ordering is verified status, then alphabetical. There is no paid position.
    const rows = all(
      `SELECT * FROM vendors WHERE ${where} ORDER BY verified DESC, business_name ASC LIMIT ? OFFSET ?`,
      ...params, limit, offset
    );

    // Counts per category so the browse page can show which parts of the
    // directory are actually populated rather than implying depth we lack.
    const perCategory = {};
    for (const row of all('SELECT category, COUNT(*) AS n FROM vendors GROUP BY category')) {
      perCategory[row.category] = row.n;
    }

    return {
      body: {
        total,
        limit,
        offset,
        ordering: 'Verified vendors first, then alphabetical. Position is never sold.',
        countsByCategory: perCategory,
        vendors: rows.map((r) => shapeVendor(r)),
      },
    };
  },

  'GET /api/vendors/:slug': async ({ params }) => {
    const row = get('SELECT * FROM vendors WHERE slug = ?', params.slug);
    if (!row) throw new HttpError(404, 'We could not find that vendor.');
    return { body: { vendor: shapeVendor(row, { full: true }) } };
  },

  'GET /api/categories/:slug': async ({ params }) => {
    const category = CATEGORIES.find((c) => c.slug === params.slug);
    if (!category) throw new HttpError(404, 'We could not find that category.');
    const count = get('SELECT COUNT(*) AS n FROM vendors WHERE category = ?', category.slug).n;
    return { body: { category, vendorCount: count } };
  },

  /* ---------------- vendor onboarding ---------------- */

  'POST /api/vendors': async ({ req, body }) => {
    const user = requireRole(req, 'vendor');
    if (get('SELECT id FROM vendors WHERE user_id = ?', user.id)) {
      throw new HttpError(409, 'You already have a vendor profile.');
    }

    const businessName = str(body.businessName, 'Business name', { required: true, max: 160 });
    const category = oneOf(body.category, 'Category', CATEGORIES.map((c) => c.slug));
    const region = oneOf(body.region, 'Region', REGIONS);

    // The supply cap. Vendor supply stays behind couple demand, because a
    // vendor paying monthly for a patch with no enquiries is a cancellation
    // and a bad story waiting to happen. Full patch means waitlist, honestly.
    const admission = crm.admitOrWaitlist({
      userId: user.id, businessName, category, region,
    });
    if (!admission.admitted) {
      return {
        status: 202,
        body: {
          waitlisted: true,
          position: admission.position,
          patch: {
            category: admission.patch.category,
            regionGroup: admission.patch.regionGroup,
            activeVendors: admission.patch.active,
            currentCap: admission.patch.cap,
          },
          note: `${admission.patch.regionGroup} already has ${admission.patch.active} ${CATEGORIES.find((c) => c.slug === category).label.toLowerCase()} vendors for the enquiries coming through, so we are not taking payment for a patch that cannot feed you yet. You are number ${admission.position} on the list, and we will invite you the moment demand supports it. Capacity grows with real enquiry volume, never with our sales targets.`,
        },
      };
    }

    const slug = makeSlug(businessName);

    const vendorId = id('ven');
    run(
      `INSERT INTO vendors
        (id, user_id, slug, business_name, category, region, town, tagline, about,
         price_from_pence, price_unit, hero_image, hero_alt, verified, capacity_per_month,
         accepting, is_sample, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      vendorId, user.id, slug, businessName, category, region,
      str(body.town, 'Town', { max: 80 }),
      str(body.tagline, 'Tagline', { max: 200 }),
      str(body.about, 'About', { max: 4000 }),
      int(body.priceFromPence, 'Starting price', { min: 0, max: 100_000_000 }),
      'from', '', '',
      0, // Verification is never self service. It starts as unverified.
      int(body.capacityPerMonth, 'Monthly capacity', { min: 1, max: 40, fallback: 6 }),
      1, 0, now()
    );

    for (const tradition of Array.isArray(body.traditions) ? body.traditions.slice(0, 12) : []) {
      if (TRADITIONS.includes(tradition)) {
        run('INSERT OR IGNORE INTO vendor_traditions (vendor_id, tradition) VALUES (?,?)', vendorId, tradition);
      }
    }

    return {
      status: 201,
      body: {
        vendor: shapeVendor(get('SELECT * FROM vendors WHERE id = ?', vendorId), { full: true }),
        verification: {
          status: 'not started',
          note: 'AETERNA Verified is a documented set of checks completed by our team. It cannot be switched on from this form.',
          scopeUrl: '/api/policies/verification',
        },
      },
    };
  },

  'PATCH /api/vendors/me': async ({ req, body }) => {
    const user = requireRole(req, 'vendor');
    const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
    if (!vendor) throw new HttpError(404, 'Create your vendor profile first.');

    const fields = [];
    const params = [];
    const map = {
      tagline: ['tagline', (v) => str(v, 'Tagline', { max: 200 })],
      about: ['about', (v) => str(v, 'About', { max: 4000 })],
      town: ['town', (v) => str(v, 'Town', { max: 80 })],
      priceFromPence: ['price_from_pence', (v) => int(v, 'Starting price', { min: 0, max: 100_000_000 })],
      capacityPerMonth: ['capacity_per_month', (v) => int(v, 'Monthly capacity', { min: 1, max: 40, fallback: 6 })],
      accepting: ['accepting', (v) => (v ? 1 : 0)],
      region: ['region', (v) => oneOf(v, 'Region', REGIONS)],
    };
    for (const [key, [column, coerce]] of Object.entries(map)) {
      if (body[key] !== undefined) { fields.push(`${column} = ?`); params.push(coerce(body[key])); }
    }
    // verified is intentionally absent. A vendor can never set their own badge.
    if (!fields.length) throw new HttpError(400, 'There was nothing to update.');
    params.push(vendor.id);
    run(`UPDATE vendors SET ${fields.join(', ')} WHERE id = ?`, ...params);

    return { body: { vendor: shapeVendor(get('SELECT * FROM vendors WHERE id = ?', vendor.id), { full: true }) } };
  },

  'POST /api/vendors/:slug/claim': async ({ req, params }) => {
    // Demo affordance only, so a sample listing can be explored from the vendor side.
    if (process.env.AETERNA_DEMO !== '1') throw new HttpError(404, 'That endpoint does not exist.');
    const user = requireRole(req, 'vendor');
    if (get('SELECT id FROM vendors WHERE user_id = ?', user.id)) {
      throw new HttpError(409, 'This account already has a vendor profile.');
    }
    const vendor = get('SELECT * FROM vendors WHERE slug = ?', params.slug);
    if (!vendor) throw new HttpError(404, 'We could not find that listing.');
    if (vendor.user_id) throw new HttpError(409, 'That listing is already claimed.');
    run('UPDATE vendors SET user_id = ? WHERE id = ?', user.id, vendor.id);
    return { body: { vendor: shapeVendor(get('SELECT * FROM vendors WHERE id = ?', vendor.id), { full: true }) } };
  },

  /* ---------------- billing, deliberately explicit about being a mock ------- */

  'POST /api/billing/vendor/subscribe': async ({ req, body }) => {
    const user = requireRole(req, 'vendor');
    const vendor = get('SELECT * FROM vendors WHERE user_id = ?', user.id);
    if (!vendor) throw new HttpError(400, 'Create your vendor profile before starting a subscription.');

    const existing = get(`SELECT * FROM subscriptions WHERE vendor_id = ? AND status = 'active'`, vendor.id);
    if (existing) throw new HttpError(409, 'This vendor already has an active subscription.');

    const status = foundingStatus();
    const plan = status.open ? 'founding' : 'standard';
    const price = status.open ? PRICING.vendor.foundingPricePence : PRICING.vendor.standardPricePence;
    const lockedUntil = plan === 'founding'
      ? new Date(Date.now() + PRICING.vendor.foundingLockMonths * 30.44 * 864e5).toISOString()
      : null;
    // Rollout offer: the first month is free for every vendor, automatically.
    const trialUntil = new Date(Date.now() + PRICING.vendor.trialDays * 864e5).toISOString();

    run(
      `INSERT INTO subscriptions (id, vendor_id, plan, price_pence, status, started_at, rate_locked_until, trial_until)
       VALUES (?,?,?,?,?,?,?,?)`,
      id('sub'), vendor.id, plan, price, 'active', now(), lockedUntil, trialUntil
    );

    return {
      status: 201,
      body: {
        plan,
        pricePence: price,
        trialUntil,
        rateLockedUntil: lockedUntil,
        paymentProcessed: false,
        note: `Your first month is free, so nothing is due until ${trialUntil.slice(0, 10)}. No payment was taken, card processing is not connected in this build.`,
      },
    };
  },

  'POST /api/billing/couple/upgrade': async ({ req }) => {
    const user = requireRole(req, 'couple');
    const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
    if (!wedding) throw new HttpError(400, 'Start a plan before upgrading.');
    if (wedding.upgraded) throw new HttpError(409, 'This wedding is already upgraded. The upgrade is paid once.');

    run('INSERT INTO couple_upgrades (id, wedding_id, amount_pence, status, created_at) VALUES (?,?,?,?,?)',
      id('upg'), wedding.id, PRICING.couple.upgradePricePence, 'paid', now());
    run('UPDATE weddings SET upgraded = 1, updated_at = ? WHERE id = ?', now(), wedding.id);

    return {
      status: 201,
      body: {
        upgraded: true,
        amountPence: PRICING.couple.upgradePricePence,
        recurring: false,
        paymentProcessed: false,
        note: 'No payment was taken. Card processing is not connected in this build.',
      },
    };
  },
};

module.exports.shapeVendor = shapeVendor;
module.exports.foundingStatus = foundingStatus;

function makeSlug(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'vendor';
  let slug = base;
  let n = 2;
  while (get('SELECT id FROM vendors WHERE slug = ?', slug)) { slug = `${base}-${n}`; n += 1; }
  return slug;
}
