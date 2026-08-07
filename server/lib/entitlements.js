'use strict';

/**
 * Free tier caps, enforced here and nowhere else.
 *
 * The rules, in plain terms:
 *   - The free plan is permanent. Nothing a couple has already created is ever
 *     deleted, hidden or made read-only when they hit a cap.
 *   - A cap blocks the next new thing, never access to existing work. If a
 *     couple downgrades conceptually by hitting a limit, they can still read
 *     and edit everything they built.
 *   - Every cap in FREE_LIMITS is published verbatim on the pricing page. If a
 *     limit is not published, it does not get enforced.
 *
 * Every refusal returns copy the interface can show directly, because a cap the
 * user cannot understand is a dark pattern.
 */

const { get } = require('../db');
const { FREE_LIMITS, UPGRADED_LIMITS, PRICING } = require('./config');
const { HttpError } = require('./http');

function limitsFor(wedding) {
  return wedding && wedding.upgraded ? UPGRADED_LIMITS : FREE_LIMITS;
}

function isUpgraded(wedding) {
  return Boolean(wedding && wedding.upgraded);
}

/**
 * A machine readable description of what this wedding can do, so the interface
 * can grey out and explain rather than fail on submit.
 */
function summarise(wedding) {
  const limits = limitsFor(wedding);
  const upgraded = isUpgraded(wedding);

  const enquiryCount = wedding ? countEnquiries(wedding.id) : 0;
  const aiUsed = wedding ? countAiTotal(wedding.id) : 0;
  const collaborators = wedding ? countCollaborators(wedding.id) : 0;

  const aiQuota = upgraded ? UPGRADED_LIMITS.aiMessagesMonthly : FREE_LIMITS.aiMessagesTotal;
  const aiUsedForQuota = upgraded ? countAiThisMonth(wedding.id) : aiUsed;

  return {
    plan: upgraded ? 'upgraded' : 'free',
    upgradePricePence: PRICING.couple.upgradePricePence,
    tabs: limits.tabs,
    features: {
      guests: upgraded,
      seating: upgraded,
      timeline: upgraded,
      sharedWorkspace: upgraded,
      exportPlan: upgraded,
    },
    ai: {
      basis: upgraded ? 'monthly' : 'one off total',
      quota: aiQuota,
      used: aiUsedForQuota,
      remaining: Math.max(0, aiQuota - aiUsedForQuota),
    },
    enquiries: {
      quota: upgraded ? null : FREE_LIMITS.enquiries,
      used: enquiryCount,
      remaining: upgraded ? null : Math.max(0, FREE_LIMITS.enquiries - enquiryCount),
    },
    collaborators: {
      quota: upgraded ? UPGRADED_LIMITS.collaborators : 0,
      used: collaborators,
    },
  };
}

/* ------------------------------------------------------------------ */
/* counters                                                            */
/* ------------------------------------------------------------------ */

function countEnquiries(weddingId) {
  const row = get('SELECT COUNT(*) AS n FROM enquiries WHERE wedding_id = ?', weddingId);
  return row ? row.n : 0;
}

function countAiTotal(weddingId) {
  const row = get('SELECT COALESCE(SUM(used), 0) AS n FROM ai_usage WHERE wedding_id = ?', weddingId);
  return row ? row.n : 0;
}

function countAiThisMonth(weddingId) {
  const period = new Date().toISOString().slice(0, 7);
  const row = get('SELECT used FROM ai_usage WHERE wedding_id = ? AND period = ?', weddingId, period);
  return row ? row.used : 0;
}

function countCollaborators(weddingId) {
  const row = get(
    `SELECT COUNT(*) AS n FROM workspace_members WHERE wedding_id = ? AND role != 'owner' AND status != 'revoked'`,
    weddingId
  );
  return row ? row.n : 0;
}

/* ------------------------------------------------------------------ */
/* gates                                                               */
/* ------------------------------------------------------------------ */

const UPGRADE_NOTE = 'The upgrade is £49 once for this wedding. It is not a subscription.';

/**
 * A feature that simply does not exist on the free plan.
 */
function requireUpgrade(wedding, feature, what) {
  if (isUpgraded(wedding)) return;
  throw new HttpError(402, {
    message: `${what} is part of the £49 upgrade. Everything you have already built stays exactly as it is.`,
    reason: 'upgrade_required',
    feature,
    upgradePricePence: PRICING.couple.upgradePricePence,
    note: UPGRADE_NOTE,
  });
}

function assertGuestsAllowed(wedding) {
  requireUpgrade(wedding, 'guests', 'The guest list');
}

function assertSeatingAllowed(wedding) {
  requireUpgrade(wedding, 'seating', 'Seating');
}

function assertTimelineAllowed(wedding) {
  requireUpgrade(wedding, 'timeline', 'The day timeline');
}

function assertWorkspaceAllowed(wedding) {
  requireUpgrade(wedding, 'sharedWorkspace', 'The shared workspace, where your planner and booked vendors work from the same page,');
}

function assertExportAllowed(wedding) {
  requireUpgrade(wedding, 'exportPlan', 'Exporting your plan');
}

/**
 * Enquiries. The free plan gets one, so a couple can feel the routing work
 * before paying, which is the point of it.
 */
function assertEnquiryAllowed(wedding) {
  if (isUpgraded(wedding)) return;
  const used = countEnquiries(wedding.id);
  if (used < FREE_LIMITS.enquiries) return;
  throw new HttpError(402, {
    message: `The free plan includes ${FREE_LIMITS.enquiries} enquiry, and you have used it. Your plan and that enquiry stay exactly as they are. £49 once unlocks unlimited enquiries.`,
    reason: 'enquiry_limit',
    feature: 'enquiries',
    used,
    quota: FREE_LIMITS.enquiries,
    upgradePricePence: PRICING.couple.upgradePricePence,
    note: UPGRADE_NOTE,
  });
}

/**
 * AI planner. Free is a one off total, upgraded is monthly. Reaching either
 * never affects the rest of the plan.
 */
function assertAiAllowed(wedding) {
  if (isUpgraded(wedding)) {
    const used = countAiThisMonth(wedding.id);
    if (used < UPGRADED_LIMITS.aiMessagesMonthly) return { basis: 'monthly', used, quota: UPGRADED_LIMITS.aiMessagesMonthly };
    throw new HttpError(429, {
      message: `You have used this month's ${UPGRADED_LIMITS.aiMessagesMonthly} planner messages. Your plan stays fully readable and editable, and the allowance resets at the start of next month.`,
      reason: 'fair_use_monthly',
      used,
      quota: UPGRADED_LIMITS.aiMessagesMonthly,
    });
  }

  const used = countAiTotal(wedding.id);
  if (used < FREE_LIMITS.aiMessagesTotal) {
    return { basis: 'total', used, quota: FREE_LIMITS.aiMessagesTotal };
  }
  throw new HttpError(402, {
    message: `The free plan includes ${FREE_LIMITS.aiMessagesTotal} planner messages in total, and you have used them. Your whole plan and this conversation stay readable. £49 once raises it to ${UPGRADED_LIMITS.aiMessagesMonthly} a month.`,
    reason: 'ai_limit',
    feature: 'ai',
    used,
    quota: FREE_LIMITS.aiMessagesTotal,
    upgradePricePence: PRICING.couple.upgradePricePence,
    note: UPGRADE_NOTE,
  });
}

function assertCollaboratorAllowed(wedding) {
  assertWorkspaceAllowed(wedding);
  const used = countCollaborators(wedding.id);
  if (used < UPGRADED_LIMITS.collaborators) return;
  throw new HttpError(409, {
    message: `This wedding already has ${UPGRADED_LIMITS.collaborators} people on it, which is the published maximum. Remove someone to add another.`,
    reason: 'collaborator_limit',
    used,
    quota: UPGRADED_LIMITS.collaborators,
  });
}

module.exports = {
  limitsFor,
  isUpgraded,
  summarise,
  countEnquiries,
  countAiTotal,
  countAiThisMonth,
  countCollaborators,
  assertGuestsAllowed,
  assertSeatingAllowed,
  assertTimelineAllowed,
  assertWorkspaceAllowed,
  assertExportAllowed,
  assertEnquiryAllowed,
  assertAiAllowed,
  assertCollaboratorAllowed,
};
