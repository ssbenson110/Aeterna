'use strict';

/**
 * AETERNA application server.
 * Node built-ins only. No install step, no external dependencies.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { HttpError, json, readJson } = require('./lib/http');
const { purgeExpiredSessions } = require('./lib/auth');
const { seedIfEmpty, seedDemoCouple, seedAdmin } = require('./lib/seed');
const { sweepExpired } = require('./lib/routing');
const verification = require('./lib/verification');
const uploadLib = require('./lib/uploads');
const ai = require('./lib/planner-ai');
const { DB_PATH } = require('./db');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IS_HTTPS = (process.env.APP_ORIGIN || '').startsWith('https://');

/**
 * Content Security Policy for HTML pages. The app has no inline scripts, so
 * script-src is 'self' outright. Inline style attributes are used by the
 * interface (the seating canvas positions tables with them), hence
 * 'unsafe-inline' for styles only. Images: self, the data-URI favicon, and
 * the Unsplash CDN the sample listings use.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://images.unsplash.com",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/* ------------------------------------------------------------------ */
/* route table                                                         */
/* ------------------------------------------------------------------ */

const ROUTE_KEY = /^(GET|POST|PATCH|PUT|DELETE) \//;

function collectRoutes(moduleExports) {
  const routes = [];
  for (const [key, handler] of Object.entries(moduleExports)) {
    if (!ROUTE_KEY.test(key) || typeof handler !== 'function') continue;
    const [method, pattern] = key.split(' ');
    const segments = pattern.split('/').filter(Boolean);
    routes.push({
      method,
      pattern,
      segments,
      params: segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1)),
      handler,
    });
  }
  return routes;
}

const ROUTES = [
  ...collectRoutes(require('./routes/auth')),
  ...collectRoutes(require('./routes/catalog')),
  ...collectRoutes(require('./routes/enquiries')),
  ...collectRoutes(require('./routes/planner')),
  ...collectRoutes(require('./routes/workspace')),
  ...collectRoutes(require('./routes/admin')),
  ...collectRoutes(require('./routes/vendor-media')),
  ...collectRoutes(require('./routes/crm')),
  ...collectRoutes(require('./routes/billing')),
  {
    method: 'GET',
    pattern: '/api/health',
    segments: ['api', 'health'],
    params: [],
    handler: async () => ({
      body: { ok: true, service: 'aeterna', time: new Date().toISOString(), ai: ai.status() },
    }),
  },
];

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    if (route.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      const seg = route.segments[i];
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* static files                                                        */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  const resolved = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: 'Forbidden.' });
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      // Single page application fallback so deep links work on refresh.
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (indexErr, buffer) => {
        if (indexErr) { json(res, 404, { error: 'Not found.' }); return; }
        res.writeHead(200, {
          'content-type': MIME['.html'],
          'cache-control': 'no-cache',
          'content-security-policy': CSP,
        });
        res.end(buffer);
      });
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }

    const immutable = ext !== '.html';
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=3600' : 'no-cache',
      etag,
      'x-content-type-options': 'nosniff',
    };
    if (ext === '.html') headers['content-security-policy'] = CSP;
    res.writeHead(200, headers);
    fs.createReadStream(resolved).pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    json(res, 400, { error: 'Bad request.' });
    return;
  }

  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  // Only meaningful once the site is actually behind TLS, so gated on APP_ORIGIN.
  if (IS_HTTPS) res.setHeader('strict-transport-security', 'max-age=15552000');

  // Vendor uploaded images. Served only by the exact filename recorded in the
  // database, so a crafted path cannot reach anything outside the upload folder.
  if (url.pathname.startsWith('/uploads/')) {
    const resolved = uploadLib.resolveUpload(url.pathname.slice('/uploads/'.length));
    if (!resolved) { json(res, 404, { error: 'That image does not exist.' }); return; }
    res.writeHead(200, {
      'content-type': resolved.mime,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(resolved.path).pipe(res);
    return;
  }

  if (!url.pathname.startsWith('/api/')) {
    serveStatic(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
    return;
  }

  const match = matchRoute(req.method, url.pathname);
  if (!match) {
    json(res, 404, { error: 'That endpoint does not exist.' });
    return;
  }

  try {
    // Image uploads send raw bytes, so the route reads the stream itself.
    const rawBodyRoute = req.method === 'POST'
      && (/^\/api\/vendors\/me\/images$/.test(url.pathname) || url.pathname === '/api/stripe/webhook');
    const body = (!rawBodyRoute && ['POST', 'PATCH', 'PUT'].includes(req.method))
      ? await readJson(req) : {};
    const query = Object.fromEntries(url.searchParams.entries());
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';

    const result = await match.route.handler({
      req, res, body, query, params: match.params, ip, url,
    });

    if (res.writableEnded) return;
    json(res, (result && result.status) || 200, result ? result.body : null);
  } catch (error) {
    // A raw body route that failed part way through leaves unread bytes on the
    // socket. Reusing that connection makes the *next* request fail for no
    // visible reason, so close it rather than keeping it alive.
    if (req.method === 'POST'
      && (/^\/api\/vendors\/me\/images$/.test(url.pathname) || url.pathname === '/api/stripe/webhook')) {
      res.setHeader('connection', 'close');
    }
    if (error instanceof HttpError) {
      json(res, error.status, error.body || { error: error.message });
      return;
    }
    process.stderr.write(`[aeterna] ${req.method} ${url.pathname} failed: ${error && error.stack}\n`);
    json(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  } finally {
    if (process.env.AETERNA_LOG === '1') {
      process.stdout.write(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms\n`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* startup                                                             */
/* ------------------------------------------------------------------ */

const seeded = seedIfEmpty();
if (process.env.AETERNA_DEMO === '1') { seedDemoCouple(); seedAdmin(); }

// Housekeeping: move enquiries whose exclusive window lapsed on to the next
// single vendor, and clear expired sessions.
setInterval(() => {
  try {
    sweepExpired();
    purgeExpiredSessions();
    // Re-derive every badge, so an insurance expiry or an overdue re-check
    // removes it without anyone having to remember. The published scope says
    // the badge comes off when a check lapses, so this has to be automatic.
    verification.sweepBadges();
  } catch { /* keep the server up */ }
}, 15 * 60 * 1000).unref();

function aiBanner() {
  const state = ai.status();
  if (state.mode === 'live') return `live, ${state.model}`;
  return `offline engine. ${state.reason}`;
}

/**
 * Graceful shutdown. Platform deploys send SIGTERM and give the process a few
 * seconds: stop accepting connections, let in-flight requests finish, then
 * exit. SQLite in WAL mode needs no ceremony beyond a clean process exit.
 */
function shutdown(signal) {
  process.stdout.write(`[aeterna] ${signal} received, closing\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}

function bootWarnings() {
  const warnings = [];
  if (IS_HTTPS && !process.env.AETERNA_SECRET) {
    warnings.push('APP_ORIGIN is https but AETERNA_SECRET is not set. Sessions are signed with the per-disk dev secret. Set a real one: openssl rand -hex 32');
  }
  if (!process.env.APP_ORIGIN) {
    warnings.push('APP_ORIGIN is not set. Emails, RSVP links and Stripe redirects will use http://localhost. Fine in development, wrong in production.');
  }
  if (process.env.AETERNA_DEMO === '1') {
    warnings.push('AETERNA_DEMO=1 seeds demo accounts with published passwords. Never set this in production.');
  }
  if (Number(process.env.AETERNA_RATE_MULTIPLIER) > 1) {
    warnings.push(`AETERNA_RATE_MULTIPLIER=${process.env.AETERNA_RATE_MULTIPLIER} relaxes rate limits. Meant for the test suite, not production.`);
  }
  return warnings.map((w) => `  warning    ${w}\n`).join('');
}

if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Establish the real planner mode before announcing anything about it.
  // Presence of an API key proves nothing, so we ask the provider.
  ai.probe().then(() => {
    server.listen(PORT, HOST, () => {
    process.stdout.write(
      `AETERNA is running on http://localhost:${PORT}\n` +
      `  database   ${DB_PATH}\n` +
      `  vendors    ${seeded.skipped ? `${seeded.vendors} already present` : `${seeded.vendors} sample listings seeded`}\n` +
      `  AI planner ${aiBanner()}\n` +
      bootWarnings()
      );
    });
  });

  // Re-check periodically so a key that starts working is picked up, and a key
  // that stops working stops being advertised as live.
  setInterval(() => { ai.probe().catch(() => {}); }, 15 * 60 * 1000).unref();
}

module.exports = { server, ROUTES };
