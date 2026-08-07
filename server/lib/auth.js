'use strict';

/**
 * Password hashing (scrypt) and signed session tokens, built on node:crypto only.
 */

const crypto = require('node:crypto');
const { all, get, run, id, now } = require('../db');
const { HttpError, parseCookies } = require('./http');

const SESSION_COOKIE = 'aeterna_session';
const SESSION_DAYS = 30;

const SECRET =
  process.env.AETERNA_SECRET ||
  (() => {
    // Stable per-database dev secret so restarts do not sign users out.
    const fs = require('node:fs');
    const path = require('node:path');
    const file = path.join(process.env.AETERNA_DATA_DIR || path.join(__dirname, '..', '..', 'data'), '.secret');
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      const generated = crypto.randomBytes(32).toString('hex');
      try {
        fs.writeFileSync(file, generated, { mode: 0o600 });
      } catch { /* read only filesystem, fall back to process lifetime secret */ }
      return generated;
    }
  })();

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sign(value) {
  const mac = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}

function unsign(token) {
  if (typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx === -1) return null;
  const value = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function createSession(userId) {
  const sessionId = id('ses');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    sessionId, userId, now(), expires);
  return { token: sign(sessionId), expires };
}

function destroySession(token) {
  const sessionId = unsign(token);
  if (sessionId) run('DELETE FROM sessions WHERE id = ?', sessionId);
}

function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[SESSION_COOKIE];
  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token) return null;
  const sessionId = unsign(token);
  if (!sessionId) return null;
  const session = get('SELECT * FROM sessions WHERE id = ?', sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE id = ?', sessionId);
    return null;
  }
  const user = get('SELECT id, email, role, display_name, created_at FROM users WHERE id = ?', session.user_id);
  return user || null;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  return user;
}

function requireRole(req, role) {
  const user = requireUser(req);
  if (user.role !== role && user.role !== 'admin') {
    throw new HttpError(403, `This action is for ${role} accounts.`);
  }
  return user;
}

function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
}

module.exports = {
  SESSION_COOKIE,
  SESSION_DAYS,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentUser,
  requireUser,
  requireRole,
  purgeExpiredSessions,
};
