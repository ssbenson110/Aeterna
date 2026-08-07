'use strict';

/**
 * Verification operations.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * The AETERNA Verified badge is DERIVED, never toggled. `vendors.verified` is
 * written in exactly one function here, `recompute`, and its value is a pure
 * function of:
 *
 *   - the six published checks in VERIFICATION_CHECKS, all of which must pass
 *   - a current insurance record that has not expired
 *   - the annual re-check not being overdue
 *
 * An administrator cannot hand out a badge to a vendor whose checks are not
 * complete, because there is no code path that would let them. What an admin
 * does is record the outcome of each check; the badge follows.
 *
 * The corollary matters just as much: when insurance expires or a re-check
 * falls overdue, the badge comes off on its own. That is what the published
 * scope promises, so it has to happen without anyone remembering to do it.
 *
 * Every state change is appended to verification_audit with an actor, so we
 * could answer honestly if a couple ever asked what the badge meant on the day
 * they booked.
 */

const { all, get, run, id, now, logEvent } = require('../db');
const { HttpError } = require('./http');
const {
  VERIFICATION_CHECKS,
  VERIFICATION_CHECK_KEYS,
  RECHECK_INTERVAL_DAYS,
  INSURANCE_CHASE_DAYS,
  INDEMNITY_CATEGORIES,
} = require('./config');

const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (days, from = new Date()) =>
  new Date(from.getTime() + days * DAY).toISOString().slice(0, 10);
const daysUntil = (isoDate) => {
  if (!isoDate) return null;
  return Math.ceil((new Date(`${isoDate}T00:00:00Z`).getTime() - Date.now()) / DAY);
};

/* ------------------------------------------------------------------ */
/* audit                                                              */
/* ------------------------------------------------------------------ */

function audit(vendorId, action, detail, actor) {
  run(
    `INSERT INTO verification_audit (id, vendor_id, action, detail, actor_id, actor_name, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    id('aud'), vendorId, action, detail || '',
    actor ? actor.id : null, actor ? actor.display_name : 'system', now()
  );
}

function auditFor(vendorId, limit = 60) {
  return all(
    'SELECT * FROM verification_audit WHERE vendor_id = ? ORDER BY created_at DESC LIMIT ?',
    vendorId, limit
  ).map((row) => ({
    id: row.id,
    action: row.action,
    detail: row.detail,
    actor: row.actor_name,
    at: row.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/* checks                                                             */
/* ------------------------------------------------------------------ */

/**
 * Make sure a vendor has a row for every published check. Called lazily so a
 * vendor created before a check existed still gets one.
 */
function ensureChecks(vendorId) {
  const existing = new Set(
    all('SELECT check_key FROM verification_checks WHERE vendor_id = ?', vendorId)
      .map((r) => r.check_key)
  );
  for (const check of VERIFICATION_CHECKS) {
    if (existing.has(check.key)) continue;
    run(
      `INSERT INTO verification_checks (id, vendor_id, check_key, status, evidence, updated_at)
       VALUES (?,?,?,?,?,?)`,
      id('vck'), vendorId, check.key, 'outstanding', '', now()
    );
  }
}

function checksFor(vendorId) {
  ensureChecks(vendorId);
  const rows = all('SELECT * FROM verification_checks WHERE vendor_id = ?', vendorId);
  const byKey = Object.fromEntries(rows.map((r) => [r.check_key, r]));

  return VERIFICATION_CHECKS.map((check) => {
    const row = byKey[check.key] || {};
    const actor = row.completed_by ? get('SELECT display_name FROM users WHERE id = ?', row.completed_by) : null;
    return {
      key: check.key,
      label: check.label,
      evidencePrompt: check.evidencePrompt,
      requiresEvidence: Boolean(check.requiresEvidence),
      drivenBy: check.drivenBy || null,
      status: row.status || 'outstanding',
      evidence: row.evidence || '',
      completedBy: actor ? actor.display_name : null,
      completedAt: row.completed_at || null,
    };
  });
}

/**
 * Record the outcome of a check. Admin only, and the two checks that are driven
 * by other records cannot be set by hand, because that would let an admin
 * assert insurance without an expiry date attached.
 */
function setCheck({ vendorId, checkKey, status, evidence, actor }) {
  if (!VERIFICATION_CHECK_KEYS.includes(checkKey)) {
    throw new HttpError(400, 'That is not one of the published checks.');
  }
  const definition = VERIFICATION_CHECKS.find((c) => c.key === checkKey);
  if (definition.drivenBy === 'insurance_record') {
    throw new HttpError(400, 'Insurance is set by recording a certificate with its expiry date, not by ticking a box.');
  }
  if (definition.drivenBy === 'rights_confirmation') {
    throw new HttpError(400, 'Portfolio rights is set when the vendor confirms in writing from their own account.');
  }
  if (!['outstanding', 'passed', 'failed', 'not_applicable'].includes(status)) {
    throw new HttpError(400, 'That is not a valid outcome for a check.');
  }
  if (definition.requiresEvidence && status === 'passed' && !String(evidence || '').trim()) {
    throw new HttpError(400, `Record what you saw before passing ${definition.label.toLowerCase()}. ${definition.evidencePrompt}`);
  }

  ensureChecks(vendorId);
  run(
    `UPDATE verification_checks
       SET status = ?, evidence = ?, completed_by = ?, completed_at = ?, updated_at = ?
     WHERE vendor_id = ? AND check_key = ?`,
    status, String(evidence || '').slice(0, 2000),
    status === 'outstanding' ? null : actor.id,
    status === 'outstanding' ? null : now(),
    now(), vendorId, checkKey
  );

  audit(vendorId, `check.${status}`, `${definition.label}${evidence ? `: ${String(evidence).slice(0, 300)}` : ''}`, actor);
  return recompute(vendorId, actor);
}

/* ------------------------------------------------------------------ */
/* insurance                                                          */
/* ------------------------------------------------------------------ */

function currentInsurance(vendorId) {
  return get(
    `SELECT * FROM insurance_records WHERE vendor_id = ? AND superseded = 0
     ORDER BY expires_on DESC LIMIT 1`,
    vendorId
  );
}

function insuranceState(vendorId) {
  const record = currentInsurance(vendorId);
  if (!record) {
    return { present: false, valid: false, status: 'missing', label: 'No certificate recorded' };
  }
  const days = daysUntil(record.expires_on);
  const vendor = get('SELECT category FROM vendors WHERE id = ?', vendorId);
  const indemnityRequired = vendor ? INDEMNITY_CATEGORIES.includes(vendor.category) : false;
  const indemnityMissing = indemnityRequired && !record.indemnity_seen;

  let status = 'valid';
  let label = `In date until ${record.expires_on}`;
  if (days < 0) { status = 'expired'; label = `Expired on ${record.expires_on}`; }
  else if (days <= INSURANCE_CHASE_DAYS) { status = 'expiring'; label = `Expires in ${days} days`; }
  if (indemnityMissing) {
    status = status === 'valid' ? 'incomplete' : status;
    label += '. Professional indemnity has not been sighted, and this category needs it';
  }

  return {
    present: true,
    valid: days >= 0 && !indemnityMissing,
    status,
    label,
    daysRemaining: days,
    insurer: record.insurer,
    policyNumber: record.policy_number,
    coverPence: record.cover_pence,
    expiresOn: record.expires_on,
    sightedAt: record.sighted_at,
    indemnityRequired,
    indemnitySeen: Boolean(record.indemnity_seen),
  };
}

function recordInsurance({ vendorId, insurer, policyNumber, coverPence, expiresOn, indemnitySeen, actor }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiresOn || ''))) {
    throw new HttpError(400, 'Record the expiry date from the certificate, in YYYY-MM-DD form.');
  }
  if (!String(insurer || '').trim()) {
    throw new HttpError(400, 'Record which insurer issued the certificate.');
  }

  // Only one live certificate per vendor. The old one stays for the audit trail.
  run('UPDATE insurance_records SET superseded = 1 WHERE vendor_id = ? AND superseded = 0', vendorId);

  run(
    `INSERT INTO insurance_records
      (id, vendor_id, insurer, policy_number, cover_type, cover_pence, expires_on,
       sighted_at, sighted_by, indemnity_seen, superseded, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id('ins'), vendorId, String(insurer).slice(0, 160), String(policyNumber || '').slice(0, 80),
    'public_liability', Number(coverPence) || 0, expiresOn,
    today(), actor.id, indemnitySeen ? 1 : 0, 0, now()
  );

  // The insurance check follows the certificate rather than being ticked.
  ensureChecks(vendorId);
  const state = insuranceState(vendorId);
  run(
    `UPDATE verification_checks
       SET status = ?, evidence = ?, completed_by = ?, completed_at = ?, updated_at = ?
     WHERE vendor_id = ? AND check_key = 'insurance'`,
    state.valid ? 'passed' : 'outstanding',
    `${insurer}, expires ${expiresOn}`,
    actor.id, state.valid ? now() : null, now(), vendorId
  );

  audit(vendorId, 'insurance.recorded', `${insurer}, expires ${expiresOn}${indemnitySeen ? ', indemnity sighted' : ''}`, actor);
  return recompute(vendorId, actor);
}

/**
 * A vendor confirming in writing that they hold the rights to their images.
 * This is the portfolio rights check, and it can only come from the vendor.
 */
function confirmRights(vendorId, actor) {
  ensureChecks(vendorId);
  run('UPDATE vendors SET rights_confirmed_at = ? WHERE id = ?', now(), vendorId);
  run(
    `UPDATE verification_checks
       SET status = 'passed', evidence = ?, completed_by = ?, completed_at = ?, updated_at = ?
     WHERE vendor_id = ? AND check_key = 'portfolio_rights'`,
    'Confirmed in writing by the vendor from their own account',
    actor.id, now(), now(), vendorId
  );
  audit(vendorId, 'rights.confirmed', 'The vendor confirmed image rights in writing', actor);
  return recompute(vendorId, actor);
}

/* ------------------------------------------------------------------ */
/* the derivation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Why a vendor is or is not verified. Pure: reads state, decides, explains.
 */
function assess(vendorId) {
  const vendor = get('SELECT * FROM vendors WHERE id = ?', vendorId);
  if (!vendor) throw new HttpError(404, 'We could not find that vendor.');

  const checks = checksFor(vendorId);
  const insurance = insuranceState(vendorId);
  const blockers = [];

  for (const check of checks) {
    // The annual re-check does not apply until a vendor has been verified for a year.
    if (check.key === 'annual_recheck') {
      const overdue = vendor.recheck_due_on && daysUntil(vendor.recheck_due_on) < 0;
      if (overdue) blockers.push('The annual re-check is overdue.');
      continue;
    }
    if (check.key === 'insurance') {
      if (!insurance.present) blockers.push('No insurance certificate has been recorded.');
      else if (!insurance.valid) blockers.push(`Insurance is not currently valid: ${insurance.label.toLowerCase()}.`);
      continue;
    }
    if (check.status === 'passed') continue;
    if (check.status === 'failed') blockers.push(`${check.label} was recorded as failed.`);
    else blockers.push(`${check.label} is still outstanding.`);
  }

  const completed = checks.filter((c) => {
    if (c.key === 'insurance') return insurance.valid;
    if (c.key === 'annual_recheck') return !(vendor.recheck_due_on && daysUntil(vendor.recheck_due_on) < 0);
    return c.status === 'passed';
  }).length;

  return {
    vendorId,
    shouldBeVerified: blockers.length === 0,
    blockers,
    completed,
    total: checks.length,
    checks,
    insurance,
    recheckDueOn: vendor.recheck_due_on || null,
    recheckDaysRemaining: vendor.recheck_due_on ? daysUntil(vendor.recheck_due_on) : null,
  };
}

/**
 * The ONLY function in the codebase that writes vendors.verified.
 */
function recompute(vendorId, actor = null) {
  const assessment = assess(vendorId);
  const vendor = get('SELECT * FROM vendors WHERE id = ?', vendorId);
  const wasVerified = Boolean(vendor.verified);
  const shouldBe = assessment.shouldBeVerified;

  if (shouldBe && !wasVerified) {
    run(
      `UPDATE vendors
         SET verified = 1, verified_at = ?, verification_ref = 'scope-1.0',
             recheck_due_on = ?, badge_removed_reason = ''
       WHERE id = ?`,
      now(), addDays(RECHECK_INTERVAL_DAYS), vendorId
    );
    audit(vendorId, 'badge.awarded', 'All six published checks are complete and insurance is in date', actor);
    logEvent('verification.awarded', vendorId, {});
  } else if (!shouldBe && wasVerified) {
    const reason = assessment.blockers[0] || 'A published check is no longer satisfied.';
    run(
      `UPDATE vendors SET verified = 0, badge_removed_reason = ? WHERE id = ?`,
      reason, vendorId
    );
    audit(vendorId, 'badge.removed', reason, actor);
    logEvent('verification.removed', vendorId, { reason });
  } else if (shouldBe && wasVerified) {
    // Keep the re-check clock moving when a re-check is completed.
    run('UPDATE vendors SET recheck_due_on = ?, badge_removed_reason = ? WHERE id = ?',
      addDays(RECHECK_INTERVAL_DAYS), '', vendorId);
  }

  return assess(vendorId);
}

/**
 * Start the process. Recorded so the queue can show how long a vendor has been
 * waiting on us rather than the other way round.
 */
function startVerification(vendorId, actor) {
  const vendor = get('SELECT verification_started_at FROM vendors WHERE id = ?', vendorId);
  if (vendor && !vendor.verification_started_at) {
    run('UPDATE vendors SET verification_started_at = ? WHERE id = ?', now(), vendorId);
    audit(vendorId, 'verification.started', 'Checks opened', actor);
  }
  ensureChecks(vendorId);
  return assess(vendorId);
}

/* ------------------------------------------------------------------ */
/* renewals and the sweep                                             */
/* ------------------------------------------------------------------ */

function recordChase(vendorId, kind, note, actor) {
  run(
    `INSERT INTO renewal_chases (id, vendor_id, kind, due_on, note, chased_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    id('chs'), vendorId, kind || 'insurance', null, String(note || '').slice(0, 500),
    actor ? actor.id : null, now()
  );
  audit(vendorId, 'renewal.chased', `${kind || 'insurance'}${note ? `: ${note}` : ''}`, actor);
}

function chasesFor(vendorId) {
  return all('SELECT * FROM renewal_chases WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 20', vendorId)
    .map((row) => {
      const actor = row.chased_by ? get('SELECT display_name FROM users WHERE id = ?', row.chased_by) : null;
      return { id: row.id, kind: row.kind, note: row.note, by: actor ? actor.display_name : 'system', at: row.created_at };
    });
}

/**
 * Everything that needs a human, ordered by how urgent it is.
 */
function renewalQueue() {
  const rows = all(
    `SELECT v.id, v.business_name, v.slug, v.category, v.verified, v.recheck_due_on,
            i.insurer, i.expires_on
     FROM vendors v
     LEFT JOIN insurance_records i ON i.vendor_id = v.id AND i.superseded = 0
     WHERE v.is_sample = 0 OR v.verified = 1`
  );

  const items = [];
  for (const row of rows) {
    const insuranceDays = daysUntil(row.expires_on);
    if (row.expires_on && insuranceDays !== null && insuranceDays <= INSURANCE_CHASE_DAYS) {
      items.push({
        vendorId: row.id,
        vendorName: row.business_name,
        vendorSlug: row.slug,
        kind: 'insurance',
        dueOn: row.expires_on,
        daysRemaining: insuranceDays,
        urgency: insuranceDays < 0 ? 'lapsed' : insuranceDays <= 14 ? 'urgent' : 'soon',
        detail: insuranceDays < 0
          ? `Insurance lapsed on ${row.expires_on}, so the badge has been removed`
          : `Insurance expires in ${insuranceDays} days`,
        lastChasedAt: lastChase(row.id, 'insurance'),
      });
    }
    const recheckDays = daysUntil(row.recheck_due_on);
    if (row.recheck_due_on && recheckDays !== null && recheckDays <= INSURANCE_CHASE_DAYS) {
      items.push({
        vendorId: row.id,
        vendorName: row.business_name,
        vendorSlug: row.slug,
        kind: 'annual_recheck',
        dueOn: row.recheck_due_on,
        daysRemaining: recheckDays,
        urgency: recheckDays < 0 ? 'lapsed' : recheckDays <= 14 ? 'urgent' : 'soon',
        detail: recheckDays < 0
          ? `The annual re-check was due on ${row.recheck_due_on}`
          : `The annual re-check is due in ${recheckDays} days`,
        lastChasedAt: lastChase(row.id, 'annual_recheck'),
      });
    }
  }

  const order = { lapsed: 0, urgent: 1, soon: 2 };
  items.sort((a, b) => order[a.urgency] - order[b.urgency] || a.daysRemaining - b.daysRemaining);
  return items;
}

function lastChase(vendorId, kind) {
  const row = get(
    'SELECT created_at FROM renewal_chases WHERE vendor_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1',
    vendorId, kind
  );
  return row ? row.created_at : null;
}

/**
 * Recompute every badge. Run on a timer, so an expiry removes a badge without
 * anyone having to remember. This is what makes the published promise true.
 */
function sweepBadges() {
  const vendors = all('SELECT id FROM vendors WHERE verified = 1');
  let removed = 0;
  for (const vendor of vendors) {
    const before = get('SELECT verified FROM vendors WHERE id = ?', vendor.id).verified;
    recompute(vendor.id, null);
    const after = get('SELECT verified FROM vendors WHERE id = ?', vendor.id).verified;
    if (before && !after) removed += 1;
  }
  return { checked: vendors.length, removed };
}

/* ------------------------------------------------------------------ */
/* the queue                                                          */
/* ------------------------------------------------------------------ */

const QUEUE_FILTERS = ['all', 'not_started', 'in_progress', 'ready', 'verified', 'attention'];

function queue({ filter = 'all', search = '' } = {}) {
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(lower(business_name) LIKE ? OR lower(town) LIKE ? OR lower(slug) LIKE ?)');
    const like = `%${search.toLowerCase()}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const vendors = all(`SELECT * FROM vendors ${where} ORDER BY created_at DESC LIMIT 300`, ...params);

  const rows = vendors.map((vendor) => {
    const assessment = assess(vendor.id);
    const anyProgress = assessment.checks.some((c) => c.status !== 'outstanding') || assessment.insurance.present;

    let state;
    if (vendor.verified) state = 'verified';
    else if (assessment.shouldBeVerified) state = 'ready';
    else if (anyProgress) state = 'in_progress';
    else state = 'not_started';

    const needsAttention = Boolean(
      (vendor.verified && assessment.insurance.status === 'expiring')
      || assessment.insurance.status === 'expired'
      || (assessment.recheckDaysRemaining !== null && assessment.recheckDaysRemaining <= INSURANCE_CHASE_DAYS)
      || assessment.checks.some((c) => c.status === 'failed')
      || vendor.badge_removed_reason
    );

    return {
      vendorId: vendor.id,
      slug: vendor.slug,
      businessName: vendor.business_name,
      category: vendor.category,
      region: vendor.region,
      town: vendor.town,
      isSample: Boolean(vendor.is_sample),
      hasAccount: Boolean(vendor.user_id),
      verified: Boolean(vendor.verified),
      badgeRemovedReason: vendor.badge_removed_reason || '',
      state,
      needsAttention,
      completed: assessment.completed,
      total: assessment.total,
      insuranceStatus: assessment.insurance.status,
      insuranceExpiresOn: assessment.insurance.expiresOn || null,
      recheckDueOn: assessment.recheckDueOn,
      startedAt: vendor.verification_started_at || null,
      createdAt: vendor.created_at,
    };
  });

  const counts = {
    all: rows.length,
    not_started: rows.filter((r) => r.state === 'not_started').length,
    in_progress: rows.filter((r) => r.state === 'in_progress').length,
    ready: rows.filter((r) => r.state === 'ready').length,
    verified: rows.filter((r) => r.state === 'verified').length,
    attention: rows.filter((r) => r.needsAttention).length,
  };

  const filtered = filter === 'all'
    ? rows
    : filter === 'attention'
      ? rows.filter((r) => r.needsAttention)
      : rows.filter((r) => r.state === filter);

  return { counts, vendors: filtered, filters: QUEUE_FILTERS };
}

/**
 * The full dossier for one vendor.
 */
function dossier(vendorId) {
  const vendor = get('SELECT * FROM vendors WHERE id = ?', vendorId);
  if (!vendor) throw new HttpError(404, 'We could not find that vendor.');
  const assessment = assess(vendorId);

  return {
    vendor: {
      id: vendor.id,
      slug: vendor.slug,
      businessName: vendor.business_name,
      category: vendor.category,
      region: vendor.region,
      town: vendor.town,
      tagline: vendor.tagline,
      verified: Boolean(vendor.verified),
      verifiedAt: vendor.verified_at,
      badgeRemovedReason: vendor.badge_removed_reason || '',
      isSample: Boolean(vendor.is_sample),
      hasAccount: Boolean(vendor.user_id),
      accepting: Boolean(vendor.accepting),
      startedAt: vendor.verification_started_at,
      rightsConfirmedAt: vendor.rights_confirmed_at,
      adminNotes: vendor.admin_notes || '',
      createdAt: vendor.created_at,
    },
    assessment,
    chases: chasesFor(vendorId),
    audit: auditFor(vendorId),
    images: all('SELECT * FROM uploads WHERE vendor_id = ? ORDER BY is_hero DESC, sort', vendorId)
      .map((u) => ({ id: u.id, url: `/uploads/${u.filename}`, alt: u.alt, isHero: Boolean(u.is_hero) })),
  };
}

function setAdminNotes(vendorId, notes, actor) {
  run('UPDATE vendors SET admin_notes = ? WHERE id = ?', String(notes || '').slice(0, 4000), vendorId);
  audit(vendorId, 'notes.updated', 'Internal notes edited', actor);
}

module.exports = {
  ensureChecks,
  checksFor,
  setCheck,
  insuranceState,
  currentInsurance,
  recordInsurance,
  confirmRights,
  assess,
  recompute,
  startVerification,
  recordChase,
  chasesFor,
  renewalQueue,
  sweepBadges,
  queue,
  dossier,
  auditFor,
  audit,
  setAdminNotes,
  QUEUE_FILTERS,
};
