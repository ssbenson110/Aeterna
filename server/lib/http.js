'use strict';

const crypto = require('node:crypto');

class HttpError extends Error {
  /**
   * `message` may be a plain string or a structured object. A structured object
   * is returned to the client as the response body, so a route can attach useful
   * context (the blocking enquiry, the fair use policy) alongside the message.
   */
  constructor(status, message, details) {
    const isObject = message !== null && typeof message === 'object';
    super(isObject ? String(message.message || 'Request failed.') : String(message));
    this.status = status;
    this.body = isObject ? { ...message, error: message.message || 'Request failed.' } : { error: this.message };
    if (details && typeof details === 'object') Object.assign(this.body, details);
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body === undefined ? null : body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

async function readJson(req, limitBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'The request body must be a JSON object.');
  }
}

/* ---------------- validation helpers ---------------- */

function str(value, field, { required = false, max = 500, min = 0, fallback = '' } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required.`);
    return fallback;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new HttpError(400, `${field} is required.`);
  if (trimmed.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`);
  if (trimmed.length < min && trimmed.length > 0) {
    throw new HttpError(400, `${field} must be at least ${min} characters.`);
  }
  return trimmed;
}

function int(value, field, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number.`);
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max}.`);
  }
  return rounded;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === 1 || value === '1';
}

function oneOf(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${field} is required.`);
  }
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function isoDate(value, field) {
  if (!value) return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${field} must be a date in YYYY-MM-DD form.`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} is not a real date.`);
  return s;
}

/* ---------------- simple in memory rate limiter ---------------- */

const buckets = new Map();

/**
 * In-process rate limiting. AETERNA_RATE_MULTIPLIER exists for development and
 * the test suite, which legitimately registers a dozen accounts in seconds.
 * Production runs with it unset, which means 1.
 */
const RATE_MULTIPLIER = Math.max(1, Number(process.env.AETERNA_RATE_MULTIPLIER) || 1);

function rateLimit(key, max, windowMs) {
  max *= RATE_MULTIPLIER;
  const nowMs = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || nowMs > bucket.reset) {
    buckets.set(key, { count: 1, reset: nowMs + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  if (bucket.count >= max) {
    return { ok: false, retryAfter: Math.ceil((bucket.reset - nowMs) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, remaining: max - bucket.count };
}

setInterval(() => {
  const nowMs = Date.now();
  for (const [key, bucket] of buckets) if (nowMs > bucket.reset) buckets.delete(key);
}, 60_000).unref();

/* ---------------- cookies ---------------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * When APP_ORIGIN says the site is served over https, session cookies carry
 * the Secure flag so they are never sent over plaintext. Local development
 * (no APP_ORIGIN, or an http one) is unaffected.
 */
const COOKIE_SECURE = (process.env.APP_ORIGIN || '').startsWith('https://');

function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 30, httpOnly = true } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (COOKIE_SECURE) parts.push('Secure');
  appendHeader(res, 'set-cookie', parts.join('; '));
}

function clearCookie(res, name) {
  const base = `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
  appendHeader(res, 'set-cookie', COOKIE_SECURE ? `${base}; Secure` : base);
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, [value]);
  else res.setHeader(name, [].concat(existing, value));
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

module.exports = {
  HttpError,
  json,
  readJson,
  str,
  int,
  bool,
  oneOf,
  isEmail,
  isoDate,
  rateLimit,
  parseCookies,
  setCookie,
  clearCookie,
  randomId,
};
