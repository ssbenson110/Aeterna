'use strict';

const { get, run, id, now, logEvent } = require('../db');
const auth = require('../lib/auth');
const { HttpError, str, oneOf, isEmail, rateLimit, setCookie, clearCookie } = require('../lib/http');
const { seedWeddingPlan } = require('../lib/seed');
const workspace = require('../lib/workspace');

function publicUser(user, extra = {}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    createdAt: user.created_at,
    ...extra,
  };
}

function weddingFor(userId) {
  return get('SELECT * FROM weddings WHERE user_id = ? ORDER BY created_at LIMIT 1', userId);
}

function vendorFor(userId) {
  return get('SELECT * FROM vendors WHERE user_id = ? LIMIT 1', userId);
}

module.exports = {
  'POST /api/auth/register': async ({ req, res, body, ip }) => {
    const limit = rateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Too many sign up attempts. Please try again shortly.');

    const email = str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');

    const password = str(body.password, 'Password', { required: true, min: 10, max: 200 });
    if (password.length < 10) throw new HttpError(400, 'Your password needs to be at least 10 characters.');

    const role = oneOf(body.role, 'Account type', ['couple', 'vendor'], 'couple');
    const displayName = str(body.displayName, 'Name', { required: true, max: 120 });

    if (get('SELECT id FROM users WHERE email = ?', email)) {
      throw new HttpError(409, 'There is already an account with that email address. Try signing in instead.');
    }

    const userId = id('usr');
    run('INSERT INTO users (id, email, password_hash, role, display_name, created_at) VALUES (?,?,?,?,?,?)',
      userId, email, auth.hashPassword(password), role, displayName, now());

    let wedding = null;
    if (role === 'couple') {
      const weddingId = id('wed');
      const created = now();
      run(
        `INSERT INTO weddings (id, user_id, partner_one, partner_two, wedding_date, budget_pence,
          guest_count, region, traditions, notes, upgraded, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        weddingId, userId, displayName, '', null, 0, 0, 'South London', '[]', '', 0, created, created
      );
      seedWeddingPlan(weddingId, 0);
      wedding = get('SELECT * FROM weddings WHERE id = ?', weddingId);
      // The couple is a member of their own wedding from the start, so the
      // shared page has a complete list of people the moment it is opened.
      workspace.ensureOwner(wedding, get('SELECT * FROM users WHERE id = ?', userId));
    }

    const session = auth.createSession(userId);
    setCookie(res, auth.SESSION_COOKIE, session.token);
    logEvent('user.registered', userId, { role });

    const user = get('SELECT * FROM users WHERE id = ?', userId);
    return {
      status: 201,
      body: { user: publicUser(user), wedding: wedding ? shapeWedding(wedding) : null, token: session.token },
    };
  },

  'POST /api/auth/login': async ({ res, body, ip }) => {
    const limit = rateLimit(`login:${ip}`, 20, 15 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Too many sign in attempts. Please wait a few minutes and try again.');

    const email = str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
    const password = str(body.password, 'Password', { required: true, max: 200 });

    const user = get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'That email and password combination did not match an account.');
    }

    const session = auth.createSession(user.id);
    setCookie(res, auth.SESSION_COOKIE, session.token);
    logEvent('user.signed_in', user.id, {});

    const wedding = user.role === 'couple' ? weddingFor(user.id) : null;
    const vendor = user.role === 'vendor' ? vendorFor(user.id) : null;
    return {
      body: {
        user: publicUser(user),
        wedding: wedding ? shapeWedding(wedding) : null,
        vendorId: vendor ? vendor.id : null,
        token: session.token,
      },
    };
  },

  'POST /api/auth/logout': async ({ req, res }) => {
    const { parseCookies } = require('../lib/http');
    const token = parseCookies(req.headers.cookie)[auth.SESSION_COOKIE];
    if (token) auth.destroySession(token);
    clearCookie(res, auth.SESSION_COOKIE);
    return { body: { ok: true } };
  },

  'GET /api/auth/me': async ({ req }) => {
    const user = auth.currentUser(req);
    if (!user) return { body: { user: null } };
    const wedding = user.role === 'couple' ? weddingFor(user.id) : null;
    const vendor = user.role === 'vendor' ? vendorFor(user.id) : null;
    return {
      body: {
        user: publicUser(user),
        wedding: wedding ? shapeWedding(wedding) : null,
        vendor: vendor ? { id: vendor.id, slug: vendor.slug, businessName: vendor.business_name } : null,
      },
    };
  },
};

function shapeWedding(row) {
  const parse = (value) => {
    try { const out = JSON.parse(value); return Array.isArray(out) ? out : []; } catch { return []; }
  };
  const traditions = parse(row.traditions);
  const customTraditions = parse(row.custom_traditions);
  return {
    id: row.id,
    partnerOne: row.partner_one,
    partnerTwo: row.partner_two,
    weddingDate: row.wedding_date,
    budgetPence: row.budget_pence,
    guestCount: row.guest_count,
    region: row.region,
    traditions,
    customTraditions,
    // Presets and free text together, which is what matching and the planner use.
    allTraditions: traditions.concat(customTraditions),
    notes: row.notes,
    upgraded: Boolean(row.upgraded),
  };
}

module.exports.shapeWedding = shapeWedding;
module.exports.publicUser = publicUser;
module.exports.weddingFor = weddingFor;
