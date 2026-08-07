'use strict';

/**
 * AETERNA data layer.
 * Zero external dependencies: uses the Node built-in SQLite driver (node:sqlite).
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.AETERNA_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.AETERNA_DB || path.join(DATA_DIR, 'aeterna.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('couple','vendor','admin')),
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weddings (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_one    TEXT NOT NULL DEFAULT '',
  partner_two    TEXT NOT NULL DEFAULT '',
  wedding_date   TEXT,
  budget_pence   INTEGER NOT NULL DEFAULT 0,
  guest_count    INTEGER NOT NULL DEFAULT 0,
  region         TEXT NOT NULL DEFAULT 'South London',
  traditions     TEXT NOT NULL DEFAULT '[]',
  notes          TEXT NOT NULL DEFAULT '',
  upgraded       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weddings_user ON weddings(user_id);

CREATE TABLE IF NOT EXISTS vendors (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  slug               TEXT NOT NULL UNIQUE,
  business_name      TEXT NOT NULL,
  category           TEXT NOT NULL,
  region             TEXT NOT NULL,
  town               TEXT NOT NULL DEFAULT '',
  tagline            TEXT NOT NULL DEFAULT '',
  about              TEXT NOT NULL DEFAULT '',
  price_from_pence   INTEGER NOT NULL DEFAULT 0,
  price_unit         TEXT NOT NULL DEFAULT 'from',
  hero_image         TEXT NOT NULL DEFAULT '',
  hero_alt           TEXT NOT NULL DEFAULT '',
  verified           INTEGER NOT NULL DEFAULT 0,
  verified_at        TEXT,
  verification_ref   TEXT,
  capacity_per_month INTEGER NOT NULL DEFAULT 6,
  accepting          INTEGER NOT NULL DEFAULT 1,
  is_sample          INTEGER NOT NULL DEFAULT 0,
  last_routed_at     TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendors_cat ON vendors(category, region);

CREATE TABLE IF NOT EXISTS vendor_images (
  id        TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  url       TEXT NOT NULL,
  alt       TEXT NOT NULL DEFAULT '',
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vimg_vendor ON vendor_images(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_traditions (
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  tradition TEXT NOT NULL,
  PRIMARY KEY (vendor_id, tradition)
);

CREATE TABLE IF NOT EXISTS vendor_services (
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id           TEXT PRIMARY KEY,
  vendor_id    TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  plan         TEXT NOT NULL CHECK (plan IN ('founding','standard')),
  price_pence  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  started_at   TEXT NOT NULL,
  rate_locked_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_subs_vendor ON subscriptions(vendor_id);

CREATE TABLE IF NOT EXISTS couple_upgrades (
  id          TEXT PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  amount_pence INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'paid',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enquiries (
  id              TEXT PRIMARY KEY,
  reference       TEXT NOT NULL UNIQUE,
  wedding_id      TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  couple_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'awaiting_vendor',
  exclusive_until TEXT NOT NULL,
  routed_reason   TEXT NOT NULL DEFAULT '',
  attempt         INTEGER NOT NULL DEFAULT 1,
  previous_vendors TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  responded_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_enq_vendor ON enquiries(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_enq_wedding ON enquiries(wedding_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  id         TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  phase      TEXT NOT NULL DEFAULT 'Twelve months out',
  detail     TEXT NOT NULL DEFAULT '',
  done       INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  custom     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_check_wedding ON checklist_items(wedding_id);

CREATE TABLE IF NOT EXISTS budget_lines (
  id            TEXT PRIMARY KEY,
  wedding_id    TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  planned_pence INTEGER NOT NULL DEFAULT 0,
  actual_pence  INTEGER NOT NULL DEFAULT 0,
  paid          INTEGER NOT NULL DEFAULT 0,
  sort          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_budget_wedding ON budget_lines(wedding_id);

CREATE TABLE IF NOT EXISTS guests (
  id         TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  side       TEXT NOT NULL DEFAULT 'Both',
  party      TEXT NOT NULL DEFAULT '',
  rsvp       TEXT NOT NULL DEFAULT 'pending',
  dietary    TEXT NOT NULL DEFAULT '',
  table_id   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_wedding ON guests(wedding_id);

CREATE TABLE IF NOT EXISTS seating_tables (
  id         TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  capacity   INTEGER NOT NULL DEFAULT 8,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id         TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  at_time    TEXT NOT NULL DEFAULT '12:00',
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  owner      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_timeline_wedding ON timeline_events(wedding_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_wedding ON chat_messages(wedding_id, created_at);

CREATE TABLE IF NOT EXISTS ai_usage (
  wedding_id TEXT NOT NULL,
  period     TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (wedding_id, period)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

/* ---------------- shared workspace ---------------- */

/*
 * Everyone working on one wedding. The couple is the owner. A planner or helper
 * joins by invitation. A vendor row can only be created once that vendor is
 * booked, which is enforced in lib/workspace.js.
 */
CREATE TABLE IF NOT EXISTS workspace_members (
  id           TEXT PRIMARY KEY,
  wedding_id   TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  vendor_id    TEXT REFERENCES vendors(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','planner','vendor','helper')),
  display_name TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','revoked')),
  invite_token TEXT,
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  joined_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_members_wedding ON workspace_members(wedding_id, status);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_unique_vendor
  ON workspace_members(wedding_id, vendor_id) WHERE vendor_id IS NOT NULL;

/*
 * A booking is the gate. No booking, no workspace access for that vendor.
 */
CREATE TABLE IF NOT EXISTS bookings (
  id          TEXT PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id   TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  enquiry_id  TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  category    TEXT NOT NULL,
  agreed_pence INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_unique ON bookings(wedding_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor ON bookings(vendor_id, status);

/* Tasks assigned to a person or a booked vendor on the shared page. */
CREATE TABLE IF NOT EXISTS workspace_tasks (
  id           TEXT PRIMARY KEY,
  wedding_id   TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  assignee_id  TEXT REFERENCES workspace_members(id) ON DELETE SET NULL,
  due_date     TEXT,
  done         INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wtasks_wedding ON workspace_tasks(wedding_id);
CREATE INDEX IF NOT EXISTS idx_wtasks_assignee ON workspace_tasks(assignee_id);

/* A comment thread per member, so a vendor talks to the couple in context. */
CREATE TABLE IF NOT EXISTS workspace_comments (
  id          TEXT PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  thread_key  TEXT NOT NULL DEFAULT 'general',
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  author_role TEXT NOT NULL DEFAULT 'owner',
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wcomments ON workspace_comments(wedding_id, thread_key, created_at);

/* Who changed what, so nobody works from a stale version. */
CREATE TABLE IF NOT EXISTS workspace_changes (
  id          TEXT PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  actor_name  TEXT NOT NULL DEFAULT '',
  actor_role  TEXT NOT NULL DEFAULT 'owner',
  summary     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wchanges ON workspace_changes(wedding_id, created_at);

/* ---------------- verification operations ---------------- */

/*
 * One row per vendor per published check. The AETERNA Verified badge on the
 * vendors table is DERIVED from these rows plus the insurance record, and is
 * only ever written by lib/verification.js. Nothing else may set it.
 */
CREATE TABLE IF NOT EXISTS verification_checks (
  id           TEXT PRIMARY KEY,
  vendor_id    TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  check_key    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'outstanding'
                 CHECK (status IN ('outstanding','passed','failed','not_applicable')),
  evidence     TEXT NOT NULL DEFAULT '',
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vcheck_unique ON verification_checks(vendor_id, check_key);

/*
 * Insurance is its own record because it expires, and an expiry is the most
 * common reason a badge has to come off.
 */
CREATE TABLE IF NOT EXISTS insurance_records (
  id             TEXT PRIMARY KEY,
  vendor_id      TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  insurer        TEXT NOT NULL DEFAULT '',
  policy_number  TEXT NOT NULL DEFAULT '',
  cover_type     TEXT NOT NULL DEFAULT 'public_liability',
  cover_pence    INTEGER NOT NULL DEFAULT 0,
  expires_on     TEXT NOT NULL,
  sighted_at     TEXT NOT NULL,
  sighted_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  indemnity_seen INTEGER NOT NULL DEFAULT 0,
  superseded     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ins_vendor ON insurance_records(vendor_id, superseded);
CREATE INDEX IF NOT EXISTS idx_ins_expiry ON insurance_records(expires_on) WHERE superseded = 0;

/* Renewal chases, so a lapse is a process failure rather than a surprise. */
CREATE TABLE IF NOT EXISTS renewal_chases (
  id         TEXT PRIMARY KEY,
  vendor_id  TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'insurance',
  due_on     TEXT,
  note       TEXT NOT NULL DEFAULT '',
  chased_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chase_vendor ON renewal_chases(vendor_id, created_at);

/*
 * Every change to a vendor's verification state, who made it and why.
 * Append only. This is the record we would produce if a couple ever asked what
 * the badge meant on the day they booked.
 */
CREATE TABLE IF NOT EXISTS verification_audit (
  id         TEXT PRIMARY KEY,
  vendor_id  TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vaudit ON verification_audit(vendor_id, created_at);

/* Vendor uploaded profile and portfolio images. */
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  vendor_id   TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  alt         TEXT NOT NULL DEFAULT '',
  is_hero     INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_vendor ON uploads(vendor_id, sort);

/* ---------------- vendor CRM ---------------- */

/*
 * A quote is the approval mechanism on the shared page. A vendor proposes,
 * the couple approves or declines where everyone can see it, and an approval
 * is what creates the booking. There is no other proposal channel.
 */
CREATE TABLE IF NOT EXISTS quotes (
  id           TEXT PRIMARY KEY,
  wedding_id   TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id    TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  enquiry_id   TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  amount_pence INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent'
                 CHECK (status IN ('sent','approved','declined','withdrawn')),
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_quotes_wedding ON quotes(wedding_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_vendor ON quotes(vendor_id, status);

/* Payment tracking, not payment taking. The vendor records what is owed and
 * what has arrived; the couple sees their own numbers on the shared page. */
CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  wedding_id   TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id    TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  reference    TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  amount_pence INTEGER NOT NULL,
  due_on       TEXT,
  status       TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','void')),
  created_at   TEXT NOT NULL,
  paid_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_wedding ON invoices(wedding_id);

/* Dates a vendor cannot work. The router treats these as a hard filter, so a
 * booked out date never receives an enquiry it would have to decline. */
CREATE TABLE IF NOT EXISTS vendor_blackouts (
  id        TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  on_date   TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blackout_unique ON vendor_blackouts(vendor_id, on_date);

/* ---------------- guest messaging ---------------- */

/*
 * Email delivery is not connected, so messages are composed once and sent
 * through channels the couple already has: a WhatsApp link and a mail link per
 * guest, each carrying that guest's personal RSVP page. The log records what
 * was written and when.
 */
CREATE TABLE IF NOT EXISTS guest_messages (
  id         TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','yes','pending')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gmsg_wedding ON guest_messages(wedding_id, created_at);

/* ---------------- supply cap ---------------- */

/*
 * When a category and region group is full relative to enquiry demand, new
 * vendors join a waitlist instead of paying for a dead patch. The row records
 * enough to invite them the moment demand supports it.
 */
CREATE TABLE IF NOT EXISTS vendor_waitlist (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  category      TEXT NOT NULL,
  region        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','invited','joined')),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waitlist ON vendor_waitlist(category, region, status);
`;

db.exec(SCHEMA);

/* ------------------------------------------------------------------ */
/* migrations                                                          */
/*                                                                     */
/* Additive only, and safe to run repeatedly. Existing databases from   */
/* earlier builds keep their vendors, plans and enquiries.              */
/* ------------------------------------------------------------------ */

function columns(table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  } catch {
    return [];
  }
}

function addColumn(table, name, definition) {
  if (columns(table).includes(name)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  return true;
}

// Custom traditions are stored alongside the presets, as free text the couple
// typed. Kept in a separate column so preset matching stays exact.
addColumn('weddings', 'custom_traditions', `TEXT NOT NULL DEFAULT '[]'`);

// Verification operations. `verified` itself already existed; these carry the
// state around it so the badge can be explained rather than just asserted.
addColumn('vendors', 'verification_started_at', 'TEXT');
addColumn('vendors', 'recheck_due_on', 'TEXT');
addColumn('vendors', 'badge_removed_reason', `TEXT NOT NULL DEFAULT ''`);
addColumn('vendors', 'rights_confirmed_at', 'TEXT');
addColumn('vendors', 'admin_notes', `TEXT NOT NULL DEFAULT ''`);

// The seating designer. Shape, seat count and a position on the canvas,
// stored as percentages of the room so any screen size draws the same plan.
addColumn('seating_tables', 'shape', `TEXT NOT NULL DEFAULT 'round'`);
addColumn('seating_tables', 'pos_x', 'REAL NOT NULL DEFAULT 0');
addColumn('seating_tables', 'pos_y', 'REAL NOT NULL DEFAULT 0');

// Rollout offer: the first month of a vendor subscription is free.
addColumn('subscriptions', 'trial_until', 'TEXT');

// Vendor CRM: where each enquiry sits in the vendor's pipeline, plus their
// private working notes. Notes are the vendor's own and are never shown to
// the couple.
addColumn('enquiries', 'pipeline_stage', `TEXT NOT NULL DEFAULT 'new'`);
addColumn('enquiries', 'vendor_notes', `TEXT NOT NULL DEFAULT ''`);

// Sharing matrix: what the couple has chosen to show, as JSON defaults plus
// per vendor overrides. Enforced in lib/workspace.js when the vendor view is
// assembled, never in the client.
addColumn('weddings', 'sharing', `TEXT NOT NULL DEFAULT '{}'`);

// Every guest gets a personal RSVP token so they can reply from a link
// without an account. Backfilled below for guests created before this.
addColumn('guests', 'rsvp_token', 'TEXT');
addColumn('guests', 'rsvp_note', `TEXT NOT NULL DEFAULT ''`);
try {
  const crypto = require('node:crypto');
  const missing = db.prepare('SELECT id FROM guests WHERE rsvp_token IS NULL').all();
  const fill = db.prepare('UPDATE guests SET rsvp_token = ? WHERE id = ?');
  for (const row of missing) fill.run(crypto.randomBytes(12).toString('base64url'), row.id);
} catch { /* fresh database, nothing to backfill */ }

// Category renames from the five category build to the full taxonomy.
const CATEGORY_RENAMES = {
  'photography-video': 'photography',
  'decor-florals': 'decor-and-florals',
  'hair-makeup': 'hair-and-makeup',
};
for (const [from, to] of Object.entries(CATEGORY_RENAMES)) {
  try {
    db.prepare('UPDATE vendors SET category = ? WHERE category = ?').run(to, from);
    db.prepare('UPDATE enquiries SET category = ? WHERE category = ?').run(to, from);
  } catch { /* table may not exist yet on a fresh database */ }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const crypto = require('node:crypto');

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

function now() {
  return new Date().toISOString();
}

function all(sql, ...params) {
  return db.prepare(sql).all(...params).map(plain);
}

function get(sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? plain(row) : null;
}

function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

// node:sqlite returns null-prototype objects; normalise for JSON and spread.
function plain(row) {
  return Object.assign({}, row);
}

function logEvent(kind, subject, payload) {
  run(
    'INSERT INTO events (id, kind, subject, payload, created_at) VALUES (?,?,?,?,?)',
    id('evt'), kind, subject || '', JSON.stringify(payload || {}), now()
  );
}

module.exports = { db, all, get, run, id, now, plain, logEvent, DB_PATH };
