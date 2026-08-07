'use strict';

/**
 * The AI wedding planner.
 *
 * Two modes, and the mode is always reported honestly to the client:
 *   live     a Claude model answers, given the couple's real wedding context
 *   offline  a deterministic planning engine answers from the same context
 *
 * The offline engine is not a fake chatbot. It does real arithmetic on the
 * couple's budget, date and guest count and returns the same structured advice
 * the live model is asked to produce. It never pretends to be the live model.
 */

const { CATEGORIES, FAIR_USE } = require('./config');

const MODEL = process.env.AETERNA_AI_MODEL || 'claude-sonnet-4-6';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/**
 * Liveness.
 *
 * A key being present in the environment proves nothing. An earlier version of
 * this file reported "live" on presence alone and was wrong: the key in the
 * deployment environment returned 401 on every call, so every answer came from
 * the offline engine while the server cheerfully claimed otherwise.
 *
 * So the mode is now established by an actual request, and until that request
 * has returned the status is "checking" rather than an optimistic guess.
 */
const liveness = {
  state: API_KEY ? 'checking' : 'offline',
  reason: API_KEY ? 'Checking the provider' : 'No API key is configured, so the offline planning engine is answering.',
  checkedAt: null,
  model: MODEL,
};

async function probe({ timeoutMs = 8000 } = {}) {
  if (!API_KEY) {
    Object.assign(liveness, {
      state: 'offline',
      reason: 'No API key is configured, so the offline planning engine is answering.',
      checkedAt: new Date().toISOString(),
    });
    return liveness;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 8, messages: [{ role: 'user', content: 'ok' }] }),
    });

    if (response.ok) {
      Object.assign(liveness, { state: 'live', reason: '', checkedAt: new Date().toISOString() });
    } else if (response.status === 401 || response.status === 403) {
      Object.assign(liveness, {
        state: 'offline',
        reason: `The configured API key was rejected by the provider (${response.status}), so the offline planning engine is answering.`,
        checkedAt: new Date().toISOString(),
      });
    } else {
      Object.assign(liveness, {
        state: 'offline',
        reason: `The provider returned ${response.status}, so the offline planning engine is answering.`,
        checkedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    Object.assign(liveness, {
      state: 'offline',
      reason: error.name === 'AbortError'
        ? 'The provider did not respond in time, so the offline planning engine is answering.'
        : 'The provider is unreachable from this server, so the offline planning engine is answering.',
      checkedAt: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timer);
  }

  return liveness;
}

function status() {
  return {
    mode: liveness.state,
    reason: liveness.reason,
    checkedAt: liveness.checkedAt,
    model: liveness.state === 'live' ? liveness.model : null,
    keyConfigured: Boolean(API_KEY),
  };
}

/* ------------------------------------------------------------------ */
/* shared context                                                      */
/* ------------------------------------------------------------------ */

function money(pence) {
  return `£${(pence / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

function monthsUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.round((target - Date.now()) / (864e5 * 30.44)));
}

function describeWedding(wedding) {
  const traditions = safeArray(wedding.traditions);
  const months = monthsUntil(wedding.wedding_date);
  const lines = [
    `Region: ${wedding.region || 'not set'}`,
    `Wedding date: ${wedding.wedding_date || 'not set yet'}${months !== null ? ` (about ${months} months away)` : ''}`,
    `Total budget: ${wedding.budget_pence ? money(wedding.budget_pence) : 'not set'}`,
    `Guest count: ${wedding.guest_count || 'not set'}`,
    `Cultural and religious traditions: ${traditions.length ? traditions.join(', ') : 'none recorded yet'}`,
  ];
  if (wedding.partner_one || wedding.partner_two) {
    lines.unshift(`Couple: ${[wedding.partner_one, wedding.partner_two].filter(Boolean).join(' and ')}`);
  }
  if (wedding.notes) lines.push(`Notes from the couple: ${wedding.notes}`);
  return lines.join('\n');
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = `You are the AETERNA wedding planner, helping a couple plan a UK wedding.

Who you are talking to: modern, often multicultural couples marrying in South London and Kent. Many are combining two sets of traditions, sometimes across two or three days. Treat that as normal, not as an unusual complication.

How you write:
- Natural, professional, friendly, human. Use contractions.
- Never use em dashes. Never use exclamation marks.
- The mood is celebration, not luxury gloom, and not breathless hype.
- Be specific and numerate. If the couple has given a budget, a date or a guest count, do the arithmetic and show the figures.
- Short paragraphs. Use a list when a list genuinely helps.

What you must not do:
- Do not invent vendor names, prices, reviews, ratings or availability. If a recommendation needs a real vendor, tell the couple to send one enquiry through AETERNA and explain that it goes to a single verified vendor.
- Do not quote statistics as fact unless the couple gave you the number.
- Do not claim anything is guaranteed, and do not give legal or immigration advice. For a legal question about giving notice, marriage visas or recognition of a religious ceremony, say plainly that they should check with their local register office.
- Do not describe AETERNA Verified as personal vetting. It is a published checklist of checks.

House knowledge you can rely on:
- AETERNA sends each enquiry to exactly one verified vendor. There is no bidding and no lead selling.
- Vendors pay one flat monthly fee and can never pay for ranking.
- Couples plan free. There is one optional upgrade of £49 per wedding, paid once, not a subscription.
- The AI planner has a published fair use policy rather than unlimited use.

Keep answers useful and reasonably brief. Around 200 words unless the couple asks for depth.`;

/* ------------------------------------------------------------------ */
/* live mode                                                           */
/* ------------------------------------------------------------------ */

async function askClaude({ wedding, history, message }) {
  const messages = [];
  for (const entry of history.slice(-16)) {
    messages.push({ role: entry.role, content: entry.content });
  }
  messages.push({ role: 'user', content: message });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: `${SYSTEM_PROMPT}\n\nThis couple's wedding:\n${describeWedding(wedding)}`,
      messages,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`AI provider returned ${response.status}`);
    error.detail = detail.slice(0, 400);
    throw error;
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return { text: scrubVoice(text), mode: 'live', model: MODEL };
}

/**
 * Enforce the house voice rules regardless of what the model returned.
 */
function scrubVoice(text) {
  return String(text)
    .replace(/—/g, ', ')
    .replace(/\s--\s/g, ', ')
    .replace(/!+/g, '.')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\.\./g, '.');
}

/* ------------------------------------------------------------------ */
/* offline mode                                                        */
/* ------------------------------------------------------------------ */

// Planning shares used by the offline engine. These are internal planning
// heuristics for splitting a couple's own budget, not market research.
const SPLIT = [
  { key: 'venues', label: 'Venue and catering', share: 0.4 },
  { key: 'photography-video', label: 'Photography and video', share: 0.12 },
  { key: 'decor-florals', label: 'Decor and florals', share: 0.12 },
  { key: 'attire', label: 'Outfits and jewellery', share: 0.11 },
  { key: 'planners', label: 'Planning and coordination', share: 0.07 },
  { key: 'music', label: 'Music and entertainment', share: 0.07 },
  { key: 'hair-makeup', label: 'Hair and makeup', share: 0.05 },
  { key: 'stationery', label: 'Stationery and favours', share: 0.03 },
  { key: 'contingency', label: 'Contingency', share: 0.03 },
];

const TRADITION_NOTES = {
  Nikah: 'For the nikah, confirm early whether your mosque or officiant will attend your venue or whether the ceremony happens separately, and check the venue is comfortable with a dry bar or a separate serving arrangement.',
  'Hindu ceremony': 'A Hindu ceremony usually needs a mandap, open flame permission for the havan, and a morning slot. Ask any venue about fire regulations before you fall in love with it.',
  'Sikh Anand Karaj': 'An Anand Karaj takes place in the gurdwara in the morning, so plan travel time and a langar or lunch gap before an evening reception.',
  'Nigerian traditional': 'A traditional engagement usually runs as its own event with its own outfits and MC. Budget it as a separate day rather than an add-on.',
  'Ghanaian traditional': 'The knocking and engagement ceremony is its own occasion. Agree early which family covers which part so the budget conversation stays easy.',
  'Chinese tea ceremony': 'The tea ceremony is short but needs a quiet room, a set order of relatives and about 45 minutes in the schedule. Photographers should be briefed on the order.',
  'Jewish ceremony': 'Allow for the chuppah, the ketubah signing beforehand and the timing rules around Shabbat when you pick your day.',
  'Tamil ceremony': 'Muhurtham timings are often early morning and fixed by an astrologer, so lock the date and the time before booking anything else.',
  'Civil ceremony': 'You need to give notice at your local register office at least 29 days before, and a licensed venue for the legal part.',
  'Church of England': 'Banns are usually read for three Sundays, so speak to the parish well before you set the date.',
  Catholic: 'Catholic preparation courses often run months ahead, so contact the parish before you book the reception.',
  Humanist: 'A humanist ceremony is not legally binding in England and Wales, so pair it with a register office appointment.',
};

function offlineAnswer({ wedding, message }) {
  const q = message.toLowerCase();
  const traditions = safeArray(wedding.traditions);
  const months = monthsUntil(wedding.wedding_date);
  const budget = wedding.budget_pence || 0;
  const guests = wedding.guest_count || 0;
  const parts = [];

  const wantsBudget = /budget|cost|afford|spend|money|price|per head|split/.test(q);
  const wantsTimeline = /timeline|schedule|when|order|month|plan.*(first|next)|what.*do.*now/.test(q);
  const wantsVendor = /vendor|venue|photograph|florist|planner|makeup|hair|decor|band|dj|book|find|recommend/.test(q);
  const wantsGuests = /guest|invite|rsvp|seat|table|list/.test(q);
  const wantsTradition = /tradition|culture|nikah|hindu|sikh|tamil|nigerian|ghana|chinese|jewish|fusion|two.*(day|ceremon)|multicultural/.test(q);

  if (wantsBudget && budget > 0) {
    parts.push(`Here's how I'd split ${money(budget)} for a ${guests || 'still to be confirmed'} guest wedding in ${wedding.region}.`);
    const rows = SPLIT.map((s) => `- ${s.label}: ${money(Math.round(budget * s.share))}`);
    parts.push(rows.join('\n'));
    if (guests > 0) {
      const perHead = Math.round((budget * 0.4) / guests);
      parts.push(`That venue and catering figure works out at about ${money(perHead)} a head. If quotes come back well above that, the fastest levers are the guest count and the day of the week, in that order.`);
    }
    parts.push('The contingency line matters. Something always moves, and having it costed means the move doesn\'t come out of the flowers.');
  } else if (wantsBudget) {
    parts.push('I can split a budget properly once you set a total in your plan. Add a figure and a guest count, and I\'ll give you a line by line split with a per head number for catering.');
  }

  if (wantsTimeline) {
    if (months !== null) {
      parts.push(`You're about ${months} months out. Here's what I'd be doing in the next stretch.`);
      parts.push(nextActions(months, traditions).map((a) => `- ${a}`).join('\n'));
    } else {
      parts.push('Set your date in the plan and I\'ll build the countdown around it. Until then, the two things worth doing are agreeing a guest count range and agreeing who is contributing what.');
    }
  }

  if (wantsTradition && traditions.length) {
    parts.push('On your traditions, a few things worth locking early.');
    parts.push(traditions
      .map((t) => TRADITION_NOTES[t])
      .filter(Boolean)
      .map((n) => `- ${n}`)
      .join('\n') || '- Tell me a little about how you want each side represented and I\'ll work it into the running order.');
    if (traditions.length > 1) {
      parts.push('With two sets of traditions, decide early whether you\'re running one long day or two distinct events. That single decision changes the budget more than any other choice you\'ll make.');
    }
  } else if (wantsTradition) {
    parts.push('Add your traditions to your plan and I\'ll fold the specific requirements, timings and venue questions into everything I suggest.');
  }

  if (wantsGuests) {
    if (guests > 0) {
      const tables = Math.ceil(guests / 8);
      parts.push(`At ${guests} guests you're looking at roughly ${tables} tables of eight, plus space for a top table. Build your list in three tiers, the people who must be there, the people you'd love there, and the people you'd invite if the numbers allow. Then cut from the bottom rather than agonising over the middle.`);
    } else {
      parts.push('Set a guest count in your plan and I\'ll work out tables, catering per head and the RSVP timeline for you.');
    }
  }

  if (wantsVendor) {
    const category = CATEGORIES.find((c) => q.includes(c.label.toLowerCase().split(' ')[0])) || null;
    parts.push(
      category
        ? `When you're ready for ${category.label.toLowerCase()}, send one enquiry from the browse page. It goes to a single verified vendor who matches your date, region and traditions, and nobody else sees it. No bidding, and your details are never sold on.`
        : 'When you\'re ready to approach someone, send one enquiry through AETERNA. It goes to exactly one verified vendor who matches your date, region and traditions. There\'s no bidding and no lead selling, so you get one real conversation instead of ten cold calls.'
    );
  }

  if (!parts.length) {
    parts.push(`I've got your wedding context loaded: ${wedding.region}${wedding.wedding_date ? `, ${wedding.wedding_date}` : ''}${guests ? `, ${guests} guests` : ''}${budget ? `, ${money(budget)} budget` : ''}${traditions.length ? `, ${traditions.join(' and ')}` : ''}.`);
    parts.push('Ask me for a budget split, a countdown from today to your date, guest list structure, or what to ask a venue before you book. I can also tell you what your traditions need from a venue.');
  }

  return { text: scrubVoice(parts.join('\n\n')), mode: 'offline', model: null };
}

function nextActions(months, traditions) {
  const actions = [];
  if (months > 12) {
    actions.push('Agree the guest count range and who is contributing, before anything else');
    actions.push('Shortlist venues and check they can hold your ceremony requirements');
    if (traditions.length > 1) actions.push('Decide whether this is one day or two, and cost both versions');
    actions.push('Book the venue and the photographer, they go first and they go fast for peak dates');
  } else if (months > 6) {
    actions.push('Lock the venue and catering contract, and read the corkage and supplier clauses properly');
    actions.push('Book photography and video, and decor or florals');
    actions.push('Send save the dates once the venue is signed');
    if (traditions.includes('Civil ceremony')) actions.push('Book your register office notice appointment');
  } else if (months > 3) {
    actions.push('Book hair and makeup, and schedule trials for both');
    actions.push('Send invitations and open RSVPs with a firm deadline six weeks before');
    actions.push('Confirm the running order with every supplier in writing');
    actions.push('Order outfits with enough time for two fittings');
  } else if (months > 1) {
    actions.push('Chase outstanding RSVPs and give the venue your numbers');
    actions.push('Build the hour by hour timeline and send it to every supplier');
    actions.push('Confirm final payments and who is settling each one');
    actions.push('Do the seating plan once numbers are genuinely final');
  } else {
    actions.push('Confirm arrival times with every supplier in one message thread');
    actions.push('Give one trusted person the timeline and the supplier phone numbers');
    actions.push('Pack the day before, and put the rings and documents with the person who will remember them');
    actions.push('Eat breakfast, the day moves faster than anyone expects');
  }
  return actions;
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

async function answer({ wedding, history, message }) {
  if (API_KEY) {
    try {
      return await askClaude({ wedding, history, message });
    } catch (error) {
      const fallback = offlineAnswer({ wedding, message });
      fallback.degraded = true;
      fallback.degradedReason = 'The live planner is unavailable right now, so this answer came from the offline planning engine.';
      return fallback;
    }
  }
  return offlineAnswer({ wedding, message });
}

module.exports = {
  answer,
  describeWedding,
  SYSTEM_PROMPT,
  FAIR_USE,
  probe,
  status,
  // Liveness is established by an actual request, never by the presence of a key.
  isLive: () => liveness.state === 'live',
};
