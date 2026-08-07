/**
 * Demo backend.
 *
 * This file is only loaded in the standalone build. It intercepts fetch calls to
 * /api/* and serves them from an in browser store, so the whole product can be
 * explored without running the Node server. The routing rules, pricing, fair use
 * limits and published policies are ported from the server so the demo cannot
 * drift into claiming something the real backend does not do.
 *
 * The real application code is completely unaware of this file.
 */

/* eslint-disable no-param-reassign */

const KEY = 'aeterna.demo.state';

/*
 * Taxonomy, pricing, entitlements and the published policies come from the real
 * server config, injected at build time. Keeping a second copy here would drift,
 * and a drifting demo would end up claiming something the product does not do.
 */
const CONFIG = window.AETERNA_CONFIG;
const {
  PRICING, FREE_LIMITS, UPGRADED_LIMITS, CATEGORIES, CATEGORY_FAMILIES,
  CATEGORY_BUDGET_SHARE, REGIONS, REGION_GROUPS, REGION_GROUP_NEIGHBOURS,
  TABLE_SHAPES, TABLE_SHAPE_KEYS, TRADITIONS, TRADITION_GROUPS,
  MAX_CUSTOM_TRADITION_LENGTH, WORKSPACE_ROLES, VERIFICATION_SCOPE, FAIR_USE,
  VERIFICATION_CHECKS, VERIFICATION_CHECK_KEYS, RECHECK_INTERVAL_DAYS,
  INSURANCE_CHASE_DAYS, INDEMNITY_CATEGORIES, UPLOADS,
  PIPELINE_STAGES, PIPELINE_STAGE_KEYS, SHARING_DEFAULTS, SHARING_KEYS,
  SHARING_LABELS, SUPPLY_CAP,
} = CONFIG;

const IMAGES = window.AETERNA_IMAGES;
const SEED_VENDORS = window.AETERNA_SEED_VENDORS;

const SPLIT = [
  ['Venue and catering', 0.4], ['Photography and video', 0.12], ['Decor and florals', 0.12],
  ['Outfits and jewellery', 0.11], ['Planning and coordination', 0.07], ['Music and entertainment', 0.07],
  ['Hair and makeup', 0.05], ['Stationery and favours', 0.03], ['Contingency', 0.03],
];

const CHECKLIST = window.AETERNA_CHECKLIST;
const TIMELINE = window.AETERNA_TIMELINE;

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

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 11)}`;
const nowIso = () => new Date().toISOString();

function buildVendors() {
  return SEED_VENDORS.map((spec) => {
    const hero = spec.headshot !== undefined ? IMAGES.headshots[spec.headshot] : IMAGES.categoryTiles[spec.hero];
    const gallery = [IMAGES.categoryTiles[spec.hero]]
      .concat((spec.portfolio || []).map((i) => IMAGES.portfolio[i]).filter(Boolean));
    return {
      id: uid('ven'), userId: null, slug: spec.slug, businessName: spec.business_name,
      category: spec.category, region: spec.region, town: spec.town, tagline: spec.tagline,
      about: spec.about, priceFromPence: spec.price_from_pence,
      heroImage: hero.url, heroAlt: hero.alt, verified: Boolean(spec.verified),
      capacityPerMonth: spec.capacity_per_month, accepting: true, isSample: true,
      traditions: spec.traditions || [], services: spec.services || [],
      gallery: gallery.map((g) => ({ url: g.url, alt: g.alt })),
      lastRoutedAt: null,
      // Verification operations state, mirroring the server tables.
      checks: {}, insurance: null, chases: [], audit: [], uploads: [],
      rightsConfirmedAt: null, recheckDueOn: null, badgeRemovedReason: '',
      verificationStartedAt: null, adminNotes: '',
    };
  });
}

function freshState() {
  return {
    vendors: buildVendors(),
    users: [],
    weddings: [],
    enquiries: [],
    session: null,
    chat: {},
    usage: {},
  };
}

let state;
try {
  const saved = JSON.parse(sessionStorage.getItem(KEY));
  state = saved && saved.vendors ? saved : freshState();
} catch { state = freshState(); }

let seededVerification = false;

function persist() {
  try {
    // Uploaded images are held as data URLs in the demo, which would blow the
    // session storage quota, so they are kept in memory for this page only.
    sessionStorage.setItem(KEY, JSON.stringify(state, (key, value) => (
      key === 'uploads' ? [] : value
    )));
  } catch { /* private mode or over quota, carry on in memory */ }
}

const currentUser = () => (state.session ? state.users.find((u) => u.id === state.session) || null : null);
const weddingOf = (userId) => state.weddings.find((w) => w.userId === userId) || null;
const vendorOf = (userId) => state.vendors.find((v) => v.userId === userId) || null;

/* ------------------------------------------------------------------ */
/* planner scaffolding                                                 */
/* ------------------------------------------------------------------ */

function newWedding(userId, displayName) {
  const wedding = {
    id: uid('wed'), userId, partnerOne: displayName, partnerTwo: '',
    weddingDate: null, budgetPence: 0, guestCount: 0, region: 'South London',
    traditions: [], customTraditions: [], notes: '', upgraded: false,
    members: [], bookings: [], wtasks: [], wcomments: [], changes: [],
    checklist: CHECKLIST.map((item, index) => ({
      id: uid('chk'), title: item.title, phase: item.phase, detail: item.detail || '',
      done: false, sort: index, custom: false,
    })),
    budget: SPLIT.map(([category], index) => ({
      id: uid('bud'), category, plannedPence: 0, actualPence: 0, paid: false, sort: index,
    })),
    guests: [],
    tables: ['Top table', 'Table 1', 'Table 2', 'Table 3'].map((name, index) => ({
      id: uid('tbl'), name,
      capacity: index === 0 ? 6 : 8,
      shape: index === 0 ? 'head' : 'round',
      x: index === 0 ? 34 : 12 + index * 22,
      y: index === 0 ? 6 : 46,
    })),
    timeline: TIMELINE.map((event) => ({
      id: uid('tml'), time: event.at_time, title: event.title, detail: event.detail || '', owner: event.owner || '',
    })),
  };
  state.weddings.push(wedding);
  return wedding;
}

function shapeWedding(w) {
  return {
    id: w.id, partnerOne: w.partnerOne, partnerTwo: w.partnerTwo, weddingDate: w.weddingDate,
    budgetPence: w.budgetPence, guestCount: w.guestCount, region: w.region,
    traditions: w.traditions,
    customTraditions: w.customTraditions || [],
    allTraditions: w.traditions.concat(w.customTraditions || []),
    notes: w.notes, upgraded: w.upgraded,
  };
}

/* ---------------- entitlements, mirroring server/lib/entitlements.js ------- */

function aiUsedTotal(weddingId) {
  return Object.entries(state.usage)
    .filter(([key]) => key === weddingId || key.startsWith(`${weddingId}:`))
    .reduce((sum, [, n]) => sum + n, 0);
}

function entitlementsFor(w) {
  const upgraded = Boolean(w.upgraded);
  const quota = upgraded ? UPGRADED_LIMITS.aiMessagesMonthly : FREE_LIMITS.aiMessagesTotal;
  const used = aiUsedTotal(w.id);
  const enquiries = state.enquiries.filter((e) => e.weddingId === w.id).length;
  return {
    plan: upgraded ? 'upgraded' : 'free',
    upgradePricePence: PRICING.couple.upgradePricePence,
    tabs: upgraded ? UPGRADED_LIMITS.tabs : FREE_LIMITS.tabs,
    features: {
      guests: upgraded, seating: upgraded, timeline: upgraded,
      sharedWorkspace: upgraded, exportPlan: upgraded,
    },
    ai: {
      basis: upgraded ? 'monthly' : 'one off total',
      quota, used, remaining: Math.max(0, quota - used),
    },
    enquiries: {
      quota: upgraded ? null : FREE_LIMITS.enquiries,
      used: enquiries,
      remaining: upgraded ? null : Math.max(0, FREE_LIMITS.enquiries - enquiries),
    },
    collaborators: {
      quota: upgraded ? UPGRADED_LIMITS.collaborators : 0,
      used: (w.members || []).filter((m) => m.role !== 'owner' && m.status !== 'revoked').length,
    },
  };
}

const UPGRADE_NOTE = 'The upgrade is £49 once for this wedding. It is not a subscription.';

function needsUpgrade(w, what) {
  if (w.upgraded) return null;
  return fail(402, `${what} is part of the £49 upgrade. Everything you have already built stays exactly as it is.`,
    { reason: 'upgrade_required', upgradePricePence: PRICING.couple.upgradePricePence, note: UPGRADE_NOTE });
}

function cleanCustom(input) {
  if (!Array.isArray(input)) return [];
  const presets = new Set(TRADITIONS.map((t) => t.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const raw of input.slice(0, 24)) {
    if (typeof raw !== 'string') continue;
    const value = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '')
      .replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOM_TRADITION_LENGTH);
    if (value.length < 2) continue;
    const key = value.toLowerCase();
    if (presets.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 12) break;
  }
  return out;
}

function fullPlan(w) {
  const plannedTotal = w.budget.reduce((s, b) => s + b.plannedPence, 0);
  const actualTotal = w.budget.reduce((s, b) => s + b.actualPence, 0);
  return {
    wedding: shapeWedding(w),
    entitlements: entitlementsFor(w),
    checklist: w.checklist.map((c) => ({ ...c })),
    checklistProgress: { total: w.checklist.length, done: w.checklist.filter((c) => c.done).length },
    budget: w.budget.map((b) => ({ ...b })),
    budgetTotals: {
      budgetPence: w.budgetPence, plannedPence: plannedTotal, actualPence: actualTotal,
      remainingPence: w.budgetPence - actualTotal, unallocatedPence: w.budgetPence - plannedTotal,
    },
    guests: w.guests.map((g) => ({ ...g })),
    guestTotals: {
      total: w.guests.length,
      yes: w.guests.filter((g) => g.rsvp === 'yes').length,
      no: w.guests.filter((g) => g.rsvp === 'no').length,
      pending: w.guests.filter((g) => g.rsvp === 'pending').length,
    },
    seating: {
      shapes: TABLE_SHAPES,
      tables: w.tables.map((t) => ({
        id: t.id, name: t.name, capacity: t.capacity,
        shape: t.shape || 'round', x: t.x || 0, y: t.y || 0,
        seated: w.guests.filter((g) => g.tableId === t.id).length,
        guests: w.guests.filter((g) => g.tableId === t.id).map((g) => ({ id: g.id, name: g.name })),
      })),
    },
    timeline: [...w.timeline].sort((a, b) => a.time.localeCompare(b.time)),
  };
}

/* ------------------------------------------------------------------ */
/* routing, ported from server/lib/routing.js                          */
/* ------------------------------------------------------------------ */

const WIDER_AREA = {
  'South London': ['South East London', 'South West London', 'Kent'],
  'South East London': ['South London', 'South West London', 'West Kent'],
  'South West London': ['South London', 'South East London'],
  Kent: ['West Kent', 'East Kent', 'South East London'],
  'West Kent': ['Kent', 'South East London', 'South London'],
  'East Kent': ['Kent'],
};

function monthlyLoad(vendorId) {
  const month = new Date().toISOString().slice(0, 7);
  return state.enquiries.filter((e) => e.vendorId === vendorId
    && e.createdAt.slice(0, 7) === month
    && ['awaiting_vendor', 'accepted'].includes(e.status)).length;
}

function pickVendor({ category, region, traditions = [], budgetPence = 0, exclude = [] }) {
  const wider = WIDER_AREA[region] || [];
  const allowance = Math.round((budgetPence || 0) * (CATEGORY_BUDGET_SHARE[category] || 0.08));
  const scored = [];

  for (const vendor of state.vendors) {
    if (vendor.category !== category || !vendor.accepting) continue;
    if (exclude.includes(vendor.id)) continue;
    const load = monthlyLoad(vendor.id);
    if (load >= vendor.capacityPerMonth) continue;

    let score = 0;
    const reasons = [];
    if (vendor.region === region) { score += 50; reasons.push(`covers ${region}`); }
    else if (wider.includes(vendor.region)) { score += 25; reasons.push(`covers the wider ${region} area from ${vendor.region}`); }
    else score += 2;

    if (vendor.verified) { score += 20; reasons.push('is AETERNA Verified'); }

    const matched = traditions.filter((t) => vendor.traditions.includes(t));
    if (matched.length) {
      score += 15 * Math.min(matched.length, 2);
      reasons.push(`has logged experience with ${matched.slice(0, 2).join(' and ')}`);
    }

    if (allowance > 0 && vendor.priceFromPence > 0) {
      if (vendor.priceFromPence <= allowance) { score += 15; reasons.push('starts inside your budget for this category'); }
      else if (vendor.priceFromPence <= allowance * 1.25) { score += 5; reasons.push('starts a little above your category allowance'); }
      else score -= 20;
    }

    const lastRouted = vendor.lastRoutedAt ? new Date(vendor.lastRoutedAt).getTime() : 0;
    const daysIdle = lastRouted ? (Date.now() - lastRouted) / 864e5 : 90;
    score += Math.min(daysIdle, 60) * 0.5;
    score -= load * 4;

    scored.push({ vendor, score, reasons });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.vendor.businessName.localeCompare(b.vendor.businessName));
  const winner = scored[0];
  return {
    vendor: winner.vendor,
    reason: winner.reasons.length
      ? `Routed to ${winner.vendor.businessName} because it ${winner.reasons.join(', ')}.`
      : `Routed to ${winner.vendor.businessName} as the next available match.`,
  };
}

function shapeEnquiry(e, forVendor) {
  const vendor = state.vendors.find((v) => v.id === e.vendorId);
  const wedding = state.weddings.find((w) => w.id === e.weddingId);
  const category = CATEGORIES.find((c) => c.slug === e.category);
  const base = {
    id: e.id, reference: e.reference, category: e.category,
    categoryLabel: category ? category.label : e.category,
    message: e.message, status: e.status, exclusiveUntil: e.exclusiveUntil,
    routedReason: e.routedReason, attempt: e.attempt, createdAt: e.createdAt,
    respondedAt: e.respondedAt || null, exclusive: true, sharedWithOtherVendors: false,
  };
  if (forVendor) {
    return {
      ...base,
      wedding: wedding ? {
        weddingDate: wedding.weddingDate, guestCount: wedding.guestCount, region: wedding.region,
        budgetPence: wedding.budgetPence, traditions: wedding.traditions,
        contactReleased: e.status === 'accepted',
      } : null,
    };
  }
  return {
    ...base,
    vendor: vendor ? { id: vendor.id, slug: vendor.slug, businessName: vendor.businessName, town: vendor.town, region: vendor.region } : null,
  };
}

/* ------------------------------------------------------------------ */
/* offline planner engine, ported from server/lib/planner-ai.js        */
/* ------------------------------------------------------------------ */

const gbp = (pence) => `£${Math.round(pence / 100).toLocaleString('en-GB')}`;

function monthsUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.round((target - Date.now()) / (864e5 * 30.44)));
}

function nextActions(months, traditions) {
  if (months > 12) return [
    'Agree the guest count range and who is contributing, before anything else',
    'Shortlist venues and check they can hold your ceremony requirements',
    ...(traditions.length > 1 ? ['Decide whether this is one day or two, and cost both versions'] : []),
    'Book the venue and the photographer, they go first and they go fast for peak dates',
  ];
  if (months > 6) return [
    'Lock the venue and catering contract, and read the corkage and supplier clauses properly',
    'Book photography and video, and decor or florals',
    'Send save the dates once the venue is signed',
    ...(traditions.includes('Civil ceremony') ? ['Book your register office notice appointment'] : []),
  ];
  if (months > 3) return [
    'Book hair and makeup, and schedule trials for both',
    'Send invitations and open RSVPs with a firm deadline six weeks before',
    'Confirm the running order with every supplier in writing',
    'Order outfits with enough time for two fittings',
  ];
  if (months > 1) return [
    'Chase outstanding RSVPs and give the venue your numbers',
    'Build the hour by hour timeline and send it to every supplier',
    'Confirm final payments and who is settling each one',
    'Do the seating plan once numbers are genuinely final',
  ];
  return [
    'Confirm arrival times with every supplier in one message thread',
    'Give one trusted person the timeline and the supplier phone numbers',
    'Pack the day before, and put the rings and documents with the person who will remember them',
    'Eat breakfast, the day moves faster than anyone expects',
  ];
}

function plannerAnswer(wedding, message) {
  const q = message.toLowerCase();
  const traditions = (wedding.traditions || []).concat(wedding.customTraditions || []);
  const months = monthsUntil(wedding.weddingDate);
  const budget = wedding.budgetPence || 0;
  const guests = wedding.guestCount || 0;
  const parts = [];

  const wantsBudget = /budget|cost|afford|spend|money|price|per head|split/.test(q);
  const wantsTimeline = /timeline|schedule|when|order|month|plan.*(first|next)|what.*do.*now/.test(q);
  const wantsVendor = /vendor|venue|photograph|florist|planner|makeup|hair|decor|band|dj|book|find|recommend/.test(q);
  const wantsGuests = /guest|invite|rsvp|seat|table|list/.test(q);
  const wantsTradition = /tradition|culture|nikah|hindu|sikh|tamil|nigerian|ghana|chinese|jewish|fusion|two.*(day|ceremon)|multicultural/.test(q);

  if (wantsBudget && budget > 0) {
    parts.push(`Here's how I'd split ${gbp(budget)} for a ${guests || 'still to be confirmed'} guest wedding in ${wedding.region}.`);
    parts.push(SPLIT.map(([label, share]) => `- ${label}: ${gbp(Math.round(budget * share))}`).join('\n'));
    if (guests > 0) {
      parts.push(`That venue and catering figure works out at about ${gbp(Math.round((budget * 0.4) / guests))} a head. If quotes come back well above that, the fastest levers are the guest count and the day of the week, in that order.`);
    }
    parts.push("The contingency line matters. Something always moves, and having it costed means the move doesn't come out of the flowers.");
  } else if (wantsBudget) {
    parts.push("I can split a budget properly once you set a total in your plan. Add a figure and a guest count, and I'll give you a line by line split with a per head number for catering.");
  }

  if (wantsTimeline) {
    if (months !== null) {
      parts.push(`You're about ${months} months out. Here's what I'd be doing in the next stretch.`);
      parts.push(nextActions(months, traditions).map((a) => `- ${a}`).join('\n'));
    } else {
      parts.push("Set your date in the plan and I'll build the countdown around it. Until then, the two things worth doing are agreeing a guest count range and agreeing who is contributing what.");
    }
  }

  if (wantsTradition && traditions.length) {
    parts.push('On your traditions, a few things worth locking early.');
    const notes = traditions.map((t) => TRADITION_NOTES[t]).filter(Boolean).map((n) => `- ${n}`).join('\n');
    parts.push(notes || "- Tell me a little about how you want each side represented and I'll work it into the running order.");
    if (traditions.length > 1) {
      parts.push("With two sets of traditions, decide early whether you're running one long day or two distinct events. That single decision changes the budget more than any other choice you'll make.");
    }
  } else if (wantsTradition) {
    parts.push("Add your traditions to your plan and I'll fold the specific requirements, timings and venue questions into everything I suggest.");
  }

  if (wantsGuests) {
    if (guests > 0) {
      parts.push(`At ${guests} guests you're looking at roughly ${Math.ceil(guests / 8)} tables of eight, plus space for a top table. Build your list in three tiers, the people who must be there, the people you'd love there, and the people you'd invite if the numbers allow. Then cut from the bottom rather than agonising over the middle.`);
    } else {
      parts.push("Set a guest count in your plan and I'll work out tables, catering per head and the RSVP timeline for you.");
    }
  }

  if (wantsVendor) {
    parts.push("When you're ready to approach someone, send one enquiry through AETERNA. It goes to exactly one verified vendor who matches your date, region and traditions. There's no bidding and no lead selling, so you get one real conversation instead of ten cold calls.");
  }

  if (!parts.length) {
    const bits = [wedding.region, wedding.weddingDate, guests ? `${guests} guests` : '', budget ? gbp(budget) : '', traditions.join(' and ')].filter(Boolean);
    parts.push(`I've got your wedding context loaded: ${bits.join(', ')}.`);
    parts.push('Ask me for a budget split, a countdown from today to your date, guest list structure, or what to ask a venue before you book. I can also tell you what your traditions need from a venue.');
  }

  return parts.join('\n\n').replace(/—/g, ', ').replace(/!+/g, '.');
}


/* ------------------------------------------------------------------ */
/* workspace, ported from server/lib/workspace.js                      */
/*                                                                     */
/* The same rule applies here: a vendor reaches a wedding only once the */
/* couple has booked them. An enquiry alone never grants access.        */
/* ------------------------------------------------------------------ */

function ensureOwner(w, user) {
  w.members = w.members || [];
  if (w.members.some((m) => m.role === 'owner')) return;
  w.members.push({
    id: uid('mem'), userId: user.id, vendorId: null, role: 'owner',
    displayName: user.displayName, email: user.email, status: 'active', token: null,
  });
}

function recordChange(w, actor, role, summary) {
  w.changes = w.changes || [];
  w.changes.unshift({ id: uid('chg'), actor: actor || 'Someone', role: role || 'owner', summary, at: nowIso() });
  w.changes = w.changes.slice(0, 40);
}

function commentsFor(w, thread) {
  return (w.wcomments || []).filter((c) => c.thread === thread).map((c) => ({
    ...c, roleLabel: WORKSPACE_ROLES[c.role] ? WORKSPACE_ROLES[c.role].label : c.role,
  }));
}

function tasksFor(w, assigneeId) {
  return (w.wtasks || [])
    .filter((t) => (assigneeId ? t.assigneeId === assigneeId : true))
    .map((t) => {
      const assignee = (w.members || []).find((m) => m.id === t.assigneeId);
      return {
        ...t,
        assigneeName: assignee ? assignee.displayName : null,
        assigneeRole: assignee ? assignee.role : null,
      };
    });
}

function accessFor(weddingId) {
  const user = currentUser();
  if (!user) return null;
  const w = state.weddings.find((x) => x.id === weddingId);
  if (!w) return null;

  if (w.userId === user.id) {
    return { role: 'owner', wedding: w, user, member: null, can: WORKSPACE_ROLES.owner.can };
  }

  w.members = w.members || [];
  let member = w.members.find((m) => m.userId === user.id && m.status === 'active');

  // Reconnect a vendor who claimed or created their listing after being booked.
  if (!member) {
    const owned = state.vendors.find((v) => v.userId === user.id);
    if (owned) {
      const orphan = w.members.find((m) => m.vendorId === owned.id && !m.userId && m.status === 'active');
      if (orphan) { orphan.userId = user.id; member = orphan; persist(); }
    }
  }
  if (!member) return null;

  if (member.role === 'vendor') {
    const booking = (w.bookings || []).find((b) => b.vendorId === member.vendorId && b.status === 'booked');
    if (!booking) return null;
    return { role: 'vendor', wedding: w, user, member, booking, can: WORKSPACE_ROLES.vendor.can };
  }
  return { role: member.role, wedding: w, user, member, can: WORKSPACE_ROLES[member.role].can };
}

function workspaceView(access) {
  const { wedding: w, role } = access;
  const traditions = (w.traditions || []).concat(w.customTraditions || []);
  const members = (w.members || []).filter((m) => m.status !== 'revoked').map((m) => ({
    id: m.id, role: m.role, roleLabel: WORKSPACE_ROLES[m.role].label,
    name: m.displayName || m.email || 'Invited', status: m.status, isVendor: Boolean(m.vendorId),
  }));
  const timeline = [...(w.timeline || [])].sort((a, b) => a.time.localeCompare(b.time));
  const changes = w.changes || [];

  if (role === 'vendor') {
    const venueBooking = (w.bookings || []).find((b) => b.category === 'venues' && b.status === 'booked');
    const venue = venueBooking ? state.vendors.find((v) => v.id === venueBooking.vendorId) : null;
    return {
      scope: 'vendor', role, roleLabel: WORKSPACE_ROLES.vendor.label,
      notice: "You can see the details you need to do your job. The couple's full guest list, their total budget and other suppliers' prices are not shared with you.",
      wedding: {
        weddingDate: w.weddingDate, region: w.region, guestCount: w.guestCount,
        traditions, notes: w.notes,
      },
      venue: venue ? { name: venue.businessName, town: venue.town, region: venue.region } : null,
      yourBooking: {
        category: access.booking.category, agreedPence: access.booking.agreedPence,
        notes: access.booking.notes, bookedAt: access.booking.createdAt,
      },
      sharedByCouple: (() => {
        const sharing = w.sharing || { defaults: {}, perVendor: {} };
        const effective = { ...SHARING_DEFAULTS, ...(sharing.defaults || {}), ...((sharing.perVendor || {})[access.member.vendorId] || {}) };
        const counts = {};
        for (const g of w.guests || []) {
          if (g.dietary && g.rsvp !== 'no') {
            const key = g.dietary.trim().toLowerCase();
            counts[key] = (counts[key] || 0) + 1;
          }
        }
        return {
          budgetTotalPence: effective.budget_total ? w.budgetPence : undefined,
          guestSummary: effective.guest_summary
            ? { total: (w.guests || []).length, coming: (w.guests || []).filter((g) => g.rsvp === 'yes').length }
            : undefined,
          dietaryCounts: effective.dietary_counts
            ? Object.entries(counts).map(([need, count]) => ({ need, count }))
            : undefined,
          guestList: effective.full_guest_list
            ? (w.guests || []).map((g) => ({ name: g.name, side: g.side, party: g.party }))
            : undefined,
        };
      })(),
      yourQuotes: (w.quotes || []).filter((q) => q.vendorId === access.member.vendorId),
      yourInvoices: (w.invoices || []).filter((i) => i.vendorId === access.member.vendorId),
      timeline,
      tasks: tasksFor(w, access.member.id),
      comments: commentsFor(w, `vendor:${access.member.vendorId}`),
      commentThread: `vendor:${access.member.vendorId}`,
      team: members.filter((m) => m.role !== 'helper').map((m) => ({ name: m.name, roleLabel: m.roleLabel })),
      changes,
    };
  }

  const view = {
    scope: role, role, roleLabel: WORKSPACE_ROLES[role].label,
    quotes: (w.quotes || []).map((q) => ({ ...q, vendorName: (state.vendors.find((v) => v.id === q.vendorId) || {}).businessName })),
    pendingApprovals: (w.quotes || []).filter((q) => q.status === 'sent').length,
    invoices: (w.invoices || []).filter((i) => i.status !== 'void').map((i) => ({
      ...i, vendorName: (state.vendors.find((v) => v.id === i.vendorId) || {}).businessName,
    })),
    wedding: {
      id: w.id, partnerOne: w.partnerOne, partnerTwo: w.partnerTwo, weddingDate: w.weddingDate,
      region: w.region, guestCount: w.guestCount, traditions, notes: w.notes,
    },
    members,
    bookings: (w.bookings || []).map((b) => {
      const vendor = state.vendors.find((v) => v.id === b.vendorId) || {};
      return {
        id: b.id, vendorId: b.vendorId, vendorName: vendor.businessName, vendorSlug: vendor.slug,
        category: b.category, agreedPence: b.agreedPence, status: b.status,
        verified: Boolean(vendor.verified), threadKey: `vendor:${b.vendorId}`,
      };
    }),
    timeline,
    tasks: tasksFor(w),
    comments: commentsFor(w, 'general'),
    commentThread: 'general',
    changes,
  };

  if (access.can.includes('see_budget_totals')) {
    view.wedding.budgetPence = w.budgetPence;
    view.budgetSummary = {
      budgetPence: w.budgetPence,
      committedPence: (w.budget || []).reduce((sum, b) => sum + b.actualPence, 0),
    };
  }
  if (access.can.includes('see_guest_list')) {
    view.guestSummary = {
      total: (w.guests || []).length,
      coming: (w.guests || []).filter((g) => g.rsvp === 'yes').length,
    };
  }
  return view;
}


/* ------------------------------------------------------------------ */
/* verification, ported from server/lib/verification.js               */
/*                                                                     */
/* Same rule as the server: the badge is DERIVED from the six published */
/* checks plus a valid insurance certificate. There is no code path     */
/* here that awards it directly either.                                 */
/* ------------------------------------------------------------------ */

const dayMs = 864e5;
const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);
const addDays = (n) => isoDay(new Date(Date.now() + n * dayMs));
const daysUntil = (iso) => (iso ? Math.ceil((new Date(`${iso}T00:00:00Z`).getTime() - Date.now()) / dayMs) : null);

function vAudit(vendor, action, detail, actor) {
  vendor.audit = vendor.audit || [];
  vendor.audit.unshift({
    id: uid('aud'), action, detail: detail || '',
    actor: actor ? actor.displayName : 'AETERNA verification team', at: nowIso(),
  });
  vendor.audit = vendor.audit.slice(0, 80);
}

function ensureChecks(vendor) {
  vendor.checks = vendor.checks || {};
  for (const check of VERIFICATION_CHECKS) {
    if (!vendor.checks[check.key]) {
      vendor.checks[check.key] = { status: 'outstanding', evidence: '', completedBy: null, completedAt: null };
    }
  }
}

function insuranceState(vendor) {
  const record = vendor.insurance;
  if (!record) return { present: false, valid: false, status: 'missing', label: 'No certificate recorded' };
  const days = daysUntil(record.expiresOn);
  const indemnityRequired = INDEMNITY_CATEGORIES.includes(vendor.category);
  const indemnityMissing = indemnityRequired && !record.indemnitySeen;

  let status = 'valid';
  let label = `In date until ${record.expiresOn}`;
  if (days < 0) { status = 'expired'; label = `Expired on ${record.expiresOn}`; }
  else if (days <= INSURANCE_CHASE_DAYS) { status = 'expiring'; label = `Expires in ${days} days`; }
  if (indemnityMissing) {
    status = status === 'valid' ? 'incomplete' : status;
    label += '. Professional indemnity has not been sighted, and this category needs it';
  }

  return {
    present: true, valid: days >= 0 && !indemnityMissing, status, label,
    daysRemaining: days, insurer: record.insurer, policyNumber: record.policyNumber,
    coverPence: record.coverPence, expiresOn: record.expiresOn, sightedAt: record.sightedAt,
    indemnityRequired, indemnitySeen: Boolean(record.indemnitySeen),
  };
}

function assess(vendor) {
  ensureChecks(vendor);
  const insurance = insuranceState(vendor);
  const blockers = [];

  const checks = VERIFICATION_CHECKS.map((definition) => {
    const row = vendor.checks[definition.key];
    return {
      key: definition.key, label: definition.label,
      evidencePrompt: definition.evidencePrompt,
      requiresEvidence: Boolean(definition.requiresEvidence),
      drivenBy: definition.drivenBy || null,
      status: row.status, evidence: row.evidence,
      completedBy: row.completedBy, completedAt: row.completedAt,
    };
  });

  for (const check of checks) {
    if (check.key === 'annual_recheck') {
      if (vendor.recheckDueOn && daysUntil(vendor.recheckDueOn) < 0) blockers.push('The annual re-check is overdue.');
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
    if (c.key === 'annual_recheck') return !(vendor.recheckDueOn && daysUntil(vendor.recheckDueOn) < 0);
    return c.status === 'passed';
  }).length;

  return {
    vendorId: vendor.id, shouldBeVerified: blockers.length === 0, blockers,
    completed, total: checks.length, checks, insurance,
    recheckDueOn: vendor.recheckDueOn || null,
    recheckDaysRemaining: vendor.recheckDueOn ? daysUntil(vendor.recheckDueOn) : null,
  };
}

/** The only place vendor.verified is written. */
function recompute(vendor, actor) {
  const assessment = assess(vendor);
  if (assessment.shouldBeVerified && !vendor.verified) {
    vendor.verified = true;
    vendor.recheckDueOn = addDays(RECHECK_INTERVAL_DAYS);
    vendor.badgeRemovedReason = '';
    vAudit(vendor, 'badge.awarded', 'All six published checks are complete and insurance is in date', actor);
  } else if (!assessment.shouldBeVerified && vendor.verified) {
    vendor.verified = false;
    vendor.badgeRemovedReason = assessment.blockers[0] || 'A published check is no longer satisfied.';
    vAudit(vendor, 'badge.removed', vendor.badgeRemovedReason, actor);
  } else if (assessment.shouldBeVerified && vendor.verified) {
    vendor.recheckDueOn = addDays(RECHECK_INTERVAL_DAYS);
    vendor.badgeRemovedReason = '';
  }
  persist();
  return assess(vendor);
}

/**
 * Give the seeded vendors verification records that justify their badge, then
 * re-derive it, so the demo never shows a badge with nothing behind it.
 */
function seedVerification() {
  state.vendors.forEach((vendor, index) => {
    ensureChecks(vendor);
    if (!vendor.verified) {
      if (index % 2 === 0) {
        vendor.verificationStartedAt = nowIso();
        vendor.checks.identity = {
          status: 'passed', evidence: 'Companies House number sighted during onboarding',
          completedBy: 'AETERNA verification team', completedAt: nowIso(),
        };
      }
      return;
    }
    vendor.verified = false;
    vendor.verificationStartedAt = nowIso();
    for (const key of ['identity', 'references', 'video_call']) {
      vendor.checks[key] = {
        status: 'passed',
        evidence: key === 'identity' ? 'Companies House number sighted during onboarding'
          : key === 'references' ? 'Two recent clients and one industry contact contacted. Comments not recorded, they are not reviews.'
            : 'Video call completed with the named owner of the business',
        completedBy: 'AETERNA verification team', completedAt: nowIso(),
      };
    }
    vendor.checks.portfolio_rights = {
      status: 'passed', evidence: 'Confirmed in writing by the vendor during onboarding',
      completedBy: vendor.businessName, completedAt: nowIso(),
    };
    vendor.rightsConfirmedAt = nowIso();

    const monthsOut = index % 3 === 0 ? 1 : 8 + (index % 5);
    const insurers = ['Hiscox', 'Simply Business', 'AXA', 'Zurich', 'Direct Line for Business'];
    vendor.insurance = {
      insurer: insurers[index % insurers.length], policyNumber: `PL-${100000 + index * 7}`,
      coverPence: 500000000, expiresOn: addDays(Math.round(monthsOut * 30.44)),
      sightedAt: isoDay(), indemnitySeen: true,
    };
    vendor.checks.insurance = {
      status: 'passed', evidence: `${vendor.insurance.insurer}, expires ${vendor.insurance.expiresOn}`,
      completedBy: 'AETERNA verification team', completedAt: nowIso(),
    };
    recompute(vendor, null);
  });
  persist();
}

function syncVendorGallery(vendor) {
  if (!vendor.uploads || !vendor.uploads.length) {
    vendor.gallery = [];
    vendor.heroImage = '';
    vendor.heroAlt = '';
    return;
  }
  const hero = vendor.uploads.find((u) => u.isHero) || vendor.uploads[0];
  vendor.heroImage = hero.url;
  vendor.heroAlt = hero.alt;
  vendor.gallery = vendor.uploads.map((u) => ({ url: u.url, alt: u.alt }));
}

function requireAdminUser() {
  const user = currentUser();
  if (!user) return { error: fail(401, 'Please sign in to continue.') };
  if (user.role !== 'admin') return { error: fail(403, 'The verification console is for AETERNA staff.') };
  return { user };
}

function vendorById(id) {
  return state.vendors.find((v) => v.id === id) || null;
}

function queueRows() {
  return state.vendors.map((vendor) => {
    const assessment = assess(vendor);
    const anyProgress = assessment.checks.some((c) => c.status !== 'outstanding') || assessment.insurance.present;
    let stateName;
    if (vendor.verified) stateName = 'verified';
    else if (assessment.shouldBeVerified) stateName = 'ready';
    else if (anyProgress) stateName = 'in_progress';
    else stateName = 'not_started';

    const needsAttention = Boolean(
      (vendor.verified && assessment.insurance.status === 'expiring')
      || assessment.insurance.status === 'expired'
      || (assessment.recheckDaysRemaining !== null && assessment.recheckDaysRemaining <= INSURANCE_CHASE_DAYS)
      || assessment.checks.some((c) => c.status === 'failed')
      || vendor.badgeRemovedReason
    );

    return {
      vendorId: vendor.id, slug: vendor.slug, businessName: vendor.businessName,
      category: vendor.category, region: vendor.region, town: vendor.town,
      isSample: vendor.isSample, hasAccount: Boolean(vendor.userId),
      verified: vendor.verified, badgeRemovedReason: vendor.badgeRemovedReason || '',
      state: stateName, needsAttention,
      completed: assessment.completed, total: assessment.total,
      insuranceStatus: assessment.insurance.status,
      insuranceExpiresOn: assessment.insurance.expiresOn || null,
      recheckDueOn: assessment.recheckDueOn,
      startedAt: vendor.verificationStartedAt, createdAt: nowIso(),
    };
  });
}

/* ------------------------------------------------------------------ */
/* the router                                                          */
/* ------------------------------------------------------------------ */

function ok(body, status = 200) {
  return new Response(JSON.stringify(body === undefined ? null : body), {
    status, headers: { 'content-type': 'application/json' },
  });
}
function fail(status, error, extra = {}) {
  return ok({ error, message: error, ...extra }, status);
}

function requireCouple() {
  const user = currentUser();
  if (!user) throw { status: 401, message: 'Please sign in to continue.' };
  if (user.role !== 'couple') throw { status: 403, message: 'This action is for couple accounts.' };
  const wedding = weddingOf(user.id);
  if (!wedding) throw { status: 404, message: 'We could not find your plan.' };
  return { user, wedding };
}

const handlers = [
  ['GET', /^\/api\/health$/, () => ok({ ok: true, service: 'aeterna-demo', time: nowIso() })],

  ['GET', /^\/api\/meta$/, () => ok({
    categories: CATEGORIES,
    categoryFamilies: CATEGORY_FAMILIES,
    regions: REGIONS,
    regionGroups: REGION_GROUPS,
    tableShapes: TABLE_SHAPES,
    traditions: TRADITIONS,
    traditionGroups: TRADITION_GROUPS,
    maxCustomTraditionLength: MAX_CUSTOM_TRADITION_LENGTH,
    workspaceRoles: WORKSPACE_ROLES,
    aiStatus: {
      mode: 'offline',
      reason: 'This is the standalone demo build, so the offline planning engine answers every question.',
      model: null,
      keyConfigured: false,
    },
    pricing: PRICING,
    images: { hero: IMAGES.hero, couples: IMAGES.couples, categoryTiles: IMAGES.categoryTiles },
  })],

  ['GET', /^\/api\/pricing$/, () => {
    const taken = state.vendors.filter((v) => v.userId).length + 12;
    const remaining = Math.max(0, PRICING.vendor.foundingSlots - taken);
    return ok({
      vendor: {
        ...PRICING.vendor,
        founding: { slots: PRICING.vendor.foundingSlots, remaining, open: remaining > 0, currentPricePence: remaining > 0 ? 2900 : 4900 },
      },
      couple: PRICING.couple,
    });
  }],

  ['GET', /^\/api\/policies\/verification$/, () => ok(VERIFICATION_SCOPE)],
  ['GET', /^\/api\/policies\/fair-use$/, () => ok(FAIR_USE)],

  /* ---------------- auth ---------------- */

  ['GET', /^\/api\/auth\/me$/, () => {
    const user = currentUser();
    if (!user) return ok({ user: null });
    const wedding = user.role === 'couple' ? weddingOf(user.id) : null;
    const vendor = user.role === 'vendor' ? vendorOf(user.id) : null;
    return ok({
      user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
      wedding: wedding ? shapeWedding(wedding) : null,
      vendor: vendor ? { id: vendor.id, slug: vendor.slug, businessName: vendor.businessName } : null,
    });
  }],

  ['POST', /^\/api\/auth\/register$/, (m, body) => {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'Please enter a valid email address.');
    if (String(body.password || '').length < 10) return fail(400, 'Your password needs to be at least 10 characters.');
    if (state.users.some((u) => u.email === email)) return fail(409, 'There is already an account with that email address. Try signing in instead.');
    const displayName = String(body.displayName || '').trim();
    if (!displayName) return fail(400, 'Name is required.');

    const user = { id: uid('usr'), email, password: body.password, role: body.role === 'vendor' ? 'vendor' : 'couple', displayName };
    state.users.push(user);
    let wedding = null;
    if (user.role === 'couple') {
      wedding = newWedding(user.id, displayName);
      ensureOwner(wedding, user);
    }
    state.session = user.id;
    persist();
    return ok({ user: { id: user.id, email, role: user.role, displayName }, wedding: wedding ? shapeWedding(wedding) : null }, 201);
  }],

  ['POST', /^\/api\/auth\/login$/, (m, body) => {
    const email = String(body.email || '').trim().toLowerCase();
    const user = state.users.find((u) => u.email === email && u.password === body.password);
    if (!user) return fail(401, 'That email and password combination did not match an account.');
    state.session = user.id;
    persist();
    const wedding = weddingOf(user.id);
    return ok({ user: { id: user.id, email, role: user.role, displayName: user.displayName }, wedding: wedding ? shapeWedding(wedding) : null });
  }],

  ['POST', /^\/api\/auth\/logout$/, () => { state.session = null; persist(); return ok({ ok: true }); }],

  /* ---------------- vendors ---------------- */

  ['GET', /^\/api\/vendors$/, (m, body, url) => {
    const p = url.searchParams;
    let list = state.vendors.slice();
    if (p.get('category')) list = list.filter((v) => v.category === p.get('category'));
    if (p.get('region')) list = list.filter((v) => v.region === p.get('region'));
    if (p.get('tradition')) {
      const wanted = p.get('tradition').toLowerCase();
      list = list.filter((v) => v.traditions.some((t) => {
        const logged = t.toLowerCase();
        return logged.includes(wanted) || wanted.includes(logged);
      }));
    }
    const term = (p.get('q') || '').toLowerCase();
    if (term) {
      list = list.filter((v) => [v.businessName, v.tagline, v.about, v.town]
        .join(' ').toLowerCase().includes(term));
    }
    list.sort((a, b) => (Number(b.verified) - Number(a.verified)) || a.businessName.localeCompare(b.businessName));

    // Counts per category, so browse shows which parts of the directory are
    // genuinely populated rather than implying depth that is not there.
    const countsByCategory = {};
    for (const v of state.vendors) {
      countsByCategory[v.category] = (countsByCategory[v.category] || 0) + 1;
    }

    return ok({
      total: list.length, limit: 24, offset: 0,
      ordering: 'Verified vendors first, then alphabetical. Position is never sold.',
      countsByCategory,
      vendors: list.map(publicVendor),
    });
  }],

  ['GET', /^\/api\/vendors\/([^/]+)$/, (m) => {
    const vendor = state.vendors.find((v) => v.slug === m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    return ok({ vendor: { ...publicVendor(vendor), about: vendor.about, capacityPerMonth: vendor.capacityPerMonth, traditions: vendor.traditions, services: vendor.services, gallery: vendor.gallery } });
  }],

  ['POST', /^\/api\/vendors$/, (m, body) => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This action is for vendor accounts.');
    if (vendorOf(user.id)) return fail(409, 'You already have a vendor profile.');
    const businessName = String(body.businessName || '').trim();
    if (!businessName) return fail(400, 'Business name is required.');
    const slug = `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 5)}`;
    const category = CATEGORIES.find((c) => c.slug === body.category) ? body.category : 'venues';
    const tile = IMAGES.categoryTiles[category];
    const vendor = {
      id: uid('ven'), userId: user.id, slug, businessName, category,
      region: REGIONS.includes(body.region) ? body.region : 'South London',
      town: String(body.town || ''), tagline: String(body.tagline || ''), about: '',
      priceFromPence: Number(body.priceFromPence) || 0,
      heroImage: tile.url, heroAlt: tile.alt, verified: false,
      capacityPerMonth: Number(body.capacityPerMonth) || 6, accepting: true, isSample: false,
      traditions: [], services: [], gallery: [{ url: tile.url, alt: tile.alt }], lastRoutedAt: null,
    };
    state.vendors.push(vendor);
    persist();
    return ok({
      vendor: { ...publicVendor(vendor), about: '', traditions: [], services: [], gallery: vendor.gallery },
      verification: { status: 'not started', note: 'AETERNA Verified is a documented set of checks completed by our team. It cannot be switched on from this form.' },
    }, 201);
  }],

  /* ---------------- enquiries ---------------- */

  ['POST', /^\/api\/enquiries$/, (m, body) => {
    let ctx;
    try { ctx = requireCouple(); } catch (e) { return fail(e.status, e.message); }
    const { user, wedding } = ctx;
    const category = body.category;
    if (!CATEGORIES.some((c) => c.slug === category)) return fail(400, 'Category is required.');

    if (!wedding.upgraded) {
      const used = state.enquiries.filter((e) => e.weddingId === wedding.id).length;
      if (used >= FREE_LIMITS.enquiries) {
        return fail(402, `The free plan includes ${FREE_LIMITS.enquiries} enquiry, and you have used it. Your plan and that enquiry stay exactly as they are. £49 once unlocks unlimited enquiries.`,
          { reason: 'enquiry_limit', upgradePricePence: PRICING.couple.upgradePricePence, note: UPGRADE_NOTE });
      }
    }

    const live = state.enquiries.find((e) => e.weddingId === wedding.id && e.category === category
      && ['awaiting_vendor', 'accepted'].includes(e.status));
    if (live) {
      return fail(409, 'You already have a live enquiry in this category. One enquiry goes to one vendor, so we hold it there until they reply or the window closes.', { enquiry: shapeEnquiry(live, false) });
    }

    let pick = null;
    if (body.vendorId) {
      const vendor = state.vendors.find((v) => v.id === body.vendorId && v.accepting);
      if (vendor && monthlyLoad(vendor.id) < vendor.capacityPerMonth) {
        pick = { vendor, reason: `Sent directly to ${vendor.businessName} because you asked for them by name.` };
      }
    }
    if (!pick) {
        pick = pickVendor({
        category, region: wedding.region,
        traditions: (wedding.traditions || []).concat(wedding.customTraditions || []),
        budgetPence: wedding.budgetPence,
      });
    }
    if (!pick) return fail(409, 'We do not have an available vendor matching that category and region right now. Try a wider region, or come back shortly.');

    const enquiry = {
      id: uid('enq'),
      reference: `AE-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      weddingId: wedding.id, coupleUserId: user.id, vendorId: pick.vendor.id, category,
      message: String(body.message || ''), status: 'awaiting_vendor',
      exclusiveUntil: new Date(Date.now() + 48 * 3600_000).toISOString(),
      routedReason: pick.reason, attempt: 1, previousVendors: [], createdAt: nowIso(), respondedAt: null,
    };
    state.enquiries.push(enquiry);
    pick.vendor.lastRoutedAt = nowIso();
    persist();

    return ok({
      enquiry: shapeEnquiry(enquiry, false),
      routing: {
        reason: pick.reason, vendorsContacted: 1, exclusiveHours: 48,
        note: 'This enquiry went to one vendor. Nobody else received it, and your details were not sold to anyone.',
      },
    }, 201);
  }],

  ['GET', /^\/api\/enquiries$/, () => {
    const user = currentUser();
    if (!user) return fail(401, 'Please sign in to continue.');
    if (user.role === 'vendor') {
      const vendor = vendorOf(user.id);
      if (!vendor) return ok({ enquiries: [] });
      return ok({ enquiries: state.enquiries.filter((e) => e.vendorId === vendor.id).reverse().map((e) => shapeEnquiry(e, true)) });
    }
    const wedding = weddingOf(user.id);
    if (!wedding) return ok({ enquiries: [] });
    return ok({ enquiries: state.enquiries.filter((e) => e.weddingId === wedding.id).reverse().map((e) => shapeEnquiry(e, false)) });
  }],

  ['POST', /^\/api\/enquiries\/([^/]+)\/respond$/, (m, body) => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This action is for vendor accounts.');
    const vendor = vendorOf(user.id);
    const enquiry = state.enquiries.find((e) => e.id === m[1]);
    if (!enquiry) return fail(404, 'We could not find that enquiry.');
    if (!vendor || enquiry.vendorId !== vendor.id) return fail(403, 'That enquiry is not yours.');
    if (enquiry.status !== 'awaiting_vendor') return fail(409, 'That enquiry has already been answered.');

    if (body.decision === 'accept') {
      enquiry.status = 'accepted';
      enquiry.respondedAt = nowIso();
      persist();
      return ok({ enquiry: shapeEnquiry(enquiry, true), contactReleased: true });
    }

    enquiry.previousVendors.push(enquiry.vendorId);
    const wedding = state.weddings.find((w) => w.id === enquiry.weddingId);
    const pick = pickVendor({
      category: enquiry.category, region: wedding.region,
      traditions: (wedding.traditions || []).concat(wedding.customTraditions || []),
      budgetPence: wedding.budgetPence, exclude: enquiry.previousVendors,
    });
    if (!pick) {
      enquiry.status = 'no_match';
      enquiry.respondedAt = nowIso();
      persist();
      return ok({ declined: true, rerouted: false, note: 'There is no other matching vendor available, so the couple has been told plainly rather than left waiting.' });
    }
    enquiry.vendorId = pick.vendor.id;
    enquiry.attempt += 1;
    enquiry.routedReason = pick.reason;
    enquiry.exclusiveUntil = new Date(Date.now() + 48 * 3600_000).toISOString();
    pick.vendor.lastRoutedAt = nowIso();
    persist();
    return ok({ declined: true, rerouted: true, note: 'The enquiry has moved on to one other vendor. It was never held by two vendors at once.' });
  }],

  /* ---------------- planner ---------------- */

  ['GET', /^\/api\/planner$/, () => withCouple((ctx) => ok(fullPlan(ctx.wedding)))],

  ['PATCH', /^\/api\/planner\/wedding$/, (m, body) => withCouple((ctx) => {
    const w = ctx.wedding;
    if (body.partnerOne !== undefined) w.partnerOne = String(body.partnerOne);
    if (body.partnerTwo !== undefined) w.partnerTwo = String(body.partnerTwo);
    if (body.weddingDate !== undefined) w.weddingDate = body.weddingDate || null;
    if (body.budgetPence !== undefined) w.budgetPence = Number(body.budgetPence) || 0;
    if (body.guestCount !== undefined) w.guestCount = Number(body.guestCount) || 0;
    if (body.region !== undefined && REGIONS.includes(body.region)) w.region = body.region;
    if (body.notes !== undefined) w.notes = String(body.notes);
    if (Array.isArray(body.traditions)) w.traditions = body.traditions.filter((t) => TRADITIONS.includes(t)).slice(0, 12);
    if (body.customTraditions !== undefined) w.customTraditions = cleanCustom(body.customTraditions);
    persist();
    return ok(fullPlan(w));
  })],

  ['POST', /^\/api\/planner\/budget\/rebalance$/, () => withCouple((ctx) => {
    const w = ctx.wedding;
    if (!w.budgetPence) return fail(400, 'Set a total budget first and we will split it for you.');
    for (const line of w.budget) {
      const match = SPLIT.find(([label]) => label === line.category);
      if (match) line.plannedPence = Math.round(w.budgetPence * match[1]);
    }
    persist();
    return ok(fullPlan(w));
  })],

  ['POST', /^\/api\/planner\/checklist$/, (m, body) => withCouple((ctx) => {
    ctx.wedding.checklist.push({
      id: uid('chk'), title: String(body.title), phase: String(body.phase || 'First decisions'),
      detail: String(body.detail || ''), done: false, sort: 9999, custom: true,
    });
    persist();
    return ok({ ok: true }, 201);
  })],

  ['PATCH', /^\/api\/planner\/checklist\/([^/]+)$/, (m, body) => withCouple((ctx) => {
    const item = ctx.wedding.checklist.find((c) => c.id === m[1]);
    if (!item) return fail(404, 'We could not find that task.');
    if (body.done !== undefined) item.done = Boolean(body.done);
    if (body.title !== undefined) item.title = String(body.title);
    persist();
    return ok({ ok: true });
  })],

  ['DELETE', /^\/api\/planner\/checklist\/([^/]+)$/, (m) => withCouple((ctx) => {
    ctx.wedding.checklist = ctx.wedding.checklist.filter((c) => c.id !== m[1]);
    persist();
    return ok({ ok: true });
  })],

  ['POST', /^\/api\/planner\/budget$/, (m, body) => withCouple((ctx) => {
    ctx.wedding.budget.push({
      id: uid('bud'), category: String(body.category), plannedPence: Number(body.plannedPence) || 0,
      actualPence: Number(body.actualPence) || 0, paid: false, sort: 9999,
    });
    persist();
    return ok({ ok: true }, 201);
  })],

  ['PATCH', /^\/api\/planner\/budget\/([^/]+)$/, (m, body) => withCouple((ctx) => {
    const line = ctx.wedding.budget.find((b) => b.id === m[1]);
    if (!line) return fail(404, 'We could not find that budget line.');
    if (body.plannedPence !== undefined) line.plannedPence = Number(body.plannedPence) || 0;
    if (body.actualPence !== undefined) line.actualPence = Number(body.actualPence) || 0;
    if (body.paid !== undefined) line.paid = Boolean(body.paid);
    persist();
    return ok({ ok: true });
  })],

  ['DELETE', /^\/api\/planner\/budget\/([^/]+)$/, (m) => withCouple((ctx) => {
    ctx.wedding.budget = ctx.wedding.budget.filter((b) => b.id !== m[1]);
    persist();
    return ok({ ok: true });
  })],

  ['POST', /^\/api\/planner\/guests$/, (m, body) => withCouple((ctx) => {
    const blocked = needsUpgrade(ctx.wedding, 'The guest list');
    if (blocked) return blocked;
    ctx.wedding.guests.push({
      id: uid('gst'), name: String(body.name), side: body.side || 'Both', party: String(body.party || ''),
      rsvp: body.rsvp || 'pending', dietary: String(body.dietary || ''), tableId: null,
      rsvpToken: uid('rt') + uid('rt'), rsvpNote: '',
    });
    persist();
    return ok({ ok: true }, 201);
  })],

  ['PATCH', /^\/api\/planner\/guests\/([^/]+)$/, (m, body) => withCouple((ctx) => {
    const guest = ctx.wedding.guests.find((g) => g.id === m[1]);
    if (!guest) return fail(404, 'We could not find that guest.');
    for (const key of ['name', 'side', 'party', 'rsvp', 'dietary']) {
      if (body[key] !== undefined) guest[key] = String(body[key]);
    }
    if (body.tableId !== undefined) {
      const tableId = body.tableId || null;
      if (tableId) {
        const table = ctx.wedding.tables.find((t) => t.id === tableId);
        if (!table) return fail(404, 'We could not find that table.');
        const seated = ctx.wedding.guests.filter((g) => g.tableId === tableId && g.id !== guest.id).length;
        if (seated >= table.capacity) return fail(409, `${table.name} is full. Raise its capacity or pick another table.`);
      }
      guest.tableId = tableId;
    }
    persist();
    return ok({ ok: true });
  })],

  ['DELETE', /^\/api\/planner\/guests\/([^/]+)$/, (m) => withCouple((ctx) => {
    ctx.wedding.guests = ctx.wedding.guests.filter((g) => g.id !== m[1]);
    persist();
    return ok({ ok: true });
  })],

  ['POST', /^\/api\/planner\/tables$/, (m, body) => withCouple((ctx) => {
    const blocked = needsUpgrade(ctx.wedding, 'The seating designer');
    if (blocked) return blocked;
    const shape = TABLE_SHAPE_KEYS.includes(body.shape) ? body.shape : 'round';
    const spec = TABLE_SHAPES.find((sh) => sh.key === shape);
    ctx.wedding.tables.push({
      id: uid('tbl'), name: String(body.name),
      capacity: Math.min(spec.maxSeats, Math.max(spec.minSeats, Number(body.capacity) || spec.defaultSeats)),
      shape, x: 8 + Math.random() * 30, y: 8 + Math.random() * 30,
    });
    persist();
    return ok({ ok: true }, 201);
  })],

  ['PATCH', /^\/api\/planner\/tables\/([^/]+)$/, (m, body) => withCouple((ctx) => {
    const blocked = needsUpgrade(ctx.wedding, 'The seating designer');
    if (blocked) return blocked;
    const table = ctx.wedding.tables.find((t) => t.id === m[1]);
    if (!table) return fail(404, 'We could not find that table.');
    if (body.name !== undefined) table.name = String(body.name).slice(0, 80);
    if (body.shape !== undefined && TABLE_SHAPE_KEYS.includes(body.shape)) {
      const spec = TABLE_SHAPES.find((sh) => sh.key === body.shape);
      table.shape = body.shape;
      table.capacity = Math.min(spec.maxSeats, Math.max(spec.minSeats, table.capacity));
    }
    if (body.capacity !== undefined) {
      const spec = TABLE_SHAPES.find((sh) => sh.key === table.shape) || TABLE_SHAPES[0];
      const capacity = Math.min(spec.maxSeats, Math.max(spec.minSeats, Number(body.capacity) || table.capacity));
      const seated = ctx.wedding.guests.filter((g) => g.tableId === table.id).length;
      if (capacity < seated) {
        return fail(409, `${seated} guests are already seated here. Move ${seated - capacity} of them before shrinking the table.`);
      }
      table.capacity = capacity;
    }
    if (body.x !== undefined || body.y !== undefined) {
      table.x = Math.min(92, Math.max(0, Number(body.x) || 0));
      table.y = Math.min(92, Math.max(0, Number(body.y) || 0));
    }
    persist();
    return ok({ table: { id: table.id, name: table.name, capacity: table.capacity, shape: table.shape, x: table.x, y: table.y } });
  })],

  ['DELETE', /^\/api\/planner\/tables\/([^/]+)$/, (m) => withCouple((ctx) => {
    ctx.wedding.guests.forEach((g) => { if (g.tableId === m[1]) g.tableId = null; });
    ctx.wedding.tables = ctx.wedding.tables.filter((t) => t.id !== m[1]);
    persist();
    return ok({ ok: true });
  })],

  ['POST', /^\/api\/planner\/timeline$/, (m, body) => withCouple((ctx) => {
    const blocked = needsUpgrade(ctx.wedding, 'The day timeline');
    if (blocked) return blocked;
    ctx.wedding.timeline.push({
      id: uid('tml'), time: String(body.time || '12:00'), title: String(body.title),
      detail: String(body.detail || ''), owner: String(body.owner || ''),
    });
    persist();
    return ok({ ok: true }, 201);
  })],

  ['PATCH', /^\/api\/planner\/timeline\/([^/]+)$/, (m, body) => withCouple((ctx) => {
    const event = ctx.wedding.timeline.find((t) => t.id === m[1]);
    if (!event) return fail(404, 'We could not find that timeline entry.');
    for (const key of ['time', 'title', 'detail', 'owner']) {
      if (body[key] !== undefined) event[key] = String(body[key]);
    }
    persist();
    return ok({ ok: true });
  })],

  ['DELETE', /^\/api\/planner\/timeline\/([^/]+)$/, (m) => withCouple((ctx) => {
    ctx.wedding.timeline = ctx.wedding.timeline.filter((t) => t.id !== m[1]);
    persist();
    return ok({ ok: true });
  })],

  /* ---------------- ai ---------------- */

  ['GET', /^\/api\/ai\/status$/, () => withCouple((ctx) => {
    const ent = entitlementsFor(ctx.wedding);
    return ok({
      mode: 'offline',
      modeReason: 'This is the standalone demo build, so the offline planning engine answers every question. It still does real arithmetic on your plan.',
      model: null,
      fairUse: FAIR_USE,
      basis: ent.ai.basis,
      quota: ent.ai.quota,
      used: ent.ai.used,
      remaining: ent.ai.remaining,
      plan: ent.plan,
    });
  })],

  ['GET', /^\/api\/ai\/messages$/, () => withCouple((ctx) => ok({ messages: state.chat[ctx.wedding.id] || [] }))],

  ['DELETE', /^\/api\/ai\/messages$/, () => withCouple((ctx) => {
    state.chat[ctx.wedding.id] = [];
    persist();
    return ok({ ok: true });
  })],

  ['POST', /^\/api\/ai\/chat$/, (m, body) => withCouple((ctx) => {
    const w = ctx.wedding;
    const ent = entitlementsFor(w);
    if (ent.ai.remaining <= 0) {
      return w.upgraded
        ? fail(429, `You have used this month's ${ent.ai.quota} planner messages. Your plan stays fully readable and editable, and the allowance resets at the start of next month.`)
        : fail(402, `The free plan includes ${FREE_LIMITS.aiMessagesTotal} planner messages in total, and you have used them. Your whole plan and this conversation stay readable. £49 once raises it to ${UPGRADED_LIMITS.aiMessagesMonthly} a month.`,
          { reason: 'ai_limit', upgradePricePence: PRICING.couple.upgradePricePence, note: UPGRADE_NOTE });
    }
    const quota = ent.ai.quota;
    const used = ent.ai.used;
    const message = String(body.message || '').trim();
    if (!message) return fail(400, 'Message is required.');

    state.chat[w.id] = (state.chat[w.id] || []).concat({ id: uid('msg'), role: 'user', content: message, createdAt: nowIso() });
    const reply = plannerAnswer(w, message);
    state.chat[w.id] = state.chat[w.id].concat({ id: uid('msg'), role: 'assistant', content: reply, createdAt: nowIso() });
    state.usage[w.id] = used + 1;
    persist();

    return ok({
      reply, mode: 'offline', model: null, degraded: false, degradedReason: null,
      usage: {
        basis: ent.ai.basis, used: used + 1, quota,
        remaining: Math.max(0, quota - used - 1),
      },
    });
  })],


  /* ---------------- shared workspace ---------------- */

  ['GET', /^\/api\/workspaces$/, () => {
    const user = currentUser();
    if (!user) return fail(401, 'Please sign in to continue.');
    const owned = state.weddings.filter((w) => w.userId === user.id).map((w) => ({
      weddingId: w.id, role: 'owner', roleLabel: WORKSPACE_ROLES.owner.label,
      couple: [w.partnerOne, w.partnerTwo].filter(Boolean).join(' and ') || 'Your wedding',
      weddingDate: w.weddingDate, region: w.region,
    }));
    const joined = [];
    for (const w of state.weddings) {
      const member = (w.members || []).find((m) => m.userId === user.id && m.status === 'active' && m.role !== 'owner');
      if (!member) continue;
      if (member.role === 'vendor'
        && !(w.bookings || []).some((b) => b.vendorId === member.vendorId && b.status === 'booked')) continue;
      joined.push({
        weddingId: w.id, role: member.role, roleLabel: WORKSPACE_ROLES[member.role].label,
        couple: [w.partnerOne, w.partnerTwo].filter(Boolean).join(' and ') || 'A couple',
        weddingDate: w.weddingDate, region: w.region,
      });
    }
    return ok({ workspaces: owned.concat(joined) });
  }],

  ['GET', /^\/api\/workspace\/([^/]+)$/, (m) => {
    const access = accessFor(m[1]);
    if (!access) return fail(404, 'We could not find that wedding.');
    if (access.role === 'owner') {
      const blocked = needsUpgrade(access.wedding,
        'The shared workspace, where your planner and booked vendors work from the same page,');
      if (blocked) return blocked;
      ensureOwner(access.wedding, access.user);
    }
    return ok(workspaceView(access));
  }],

  ['POST', /^\/api\/workspace\/([^/]+)\/invite$/, (m, body) => {
    const access = accessFor(m[1]);
    if (!access || !access.can.includes('invite')) return fail(403, 'You do not have permission to do that on this wedding.');
    const blocked = needsUpgrade(access.wedding, 'The shared workspace');
    if (blocked) return blocked;
    if (!['planner', 'helper'].includes(body.role)) {
      return fail(400, 'You can invite a planner or a helper. Vendors join automatically once you book them.');
    }
    const email = String(body.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'Please enter a valid email address.');

    const w = access.wedding;
    w.members = w.members || [];
    if (w.members.some((mem) => mem.email.toLowerCase() === email.toLowerCase() && mem.status !== 'revoked')) {
      return fail(409, 'That person is already on this wedding.');
    }
    const token = uid('inv');
    const existing = state.users.find((u) => u.email === email.toLowerCase());
    w.members.push({
      id: uid('mem'), userId: existing ? existing.id : null, vendorId: null, role: body.role,
      displayName: String(body.displayName || ''), email, status: existing ? 'active' : 'invited', token,
    });
    recordChange(w, body.displayName || email, 'owner', `was invited as ${WORKSPACE_ROLES[body.role].label.toLowerCase()}`);
    persist();
    return ok({
      memberId: token, token, status: existing ? 'active' : 'invited',
      inviteUrl: `#/join/${token}`,
      note: existing
        ? 'They already have an account, so this wedding is on their dashboard now.'
        : 'They do not have an AETERNA account yet. Send them the invite link and it will connect to this wedding when they sign up.',
      emailSent: false,
    }, 201);
  }],

  ['POST', /^\/api\/workspace\/join\/([^/]+)$/, (m) => {
    const user = currentUser();
    if (!user) return fail(401, 'Please sign in to continue.');
    for (const w of state.weddings) {
      const member = (w.members || []).find((mem) => mem.token === m[1] && mem.status === 'invited');
      if (!member) continue;
      member.userId = user.id;
      member.status = 'active';
      member.token = null;
      recordChange(w, user.displayName, member.role, 'joined the wedding');
      persist();
      return ok({ weddingId: w.id, role: member.role });
    }
    return fail(404, 'That invitation is not valid any more.');
  }],

  ['DELETE', /^\/api\/workspace\/([^/]+)\/members\/([^/]+)$/, (m) => {
    const access = accessFor(m[1]);
    if (!access || !access.can.includes('revoke')) return fail(403, 'You do not have permission to do that.');
    const member = (access.wedding.members || []).find((mem) => mem.id === m[2]);
    if (!member) return fail(404, 'We could not find that person on this wedding.');
    if (member.role === 'owner') return fail(400, 'The couple cannot be removed from their own wedding.');
    member.status = 'revoked';
    recordChange(access.wedding, member.displayName || member.email, member.role, 'was removed from the wedding');
    persist();
    return ok({ ok: true });
  }],

  ['POST', /^\/api\/bookings$/, (m, body) => withCouple((ctx) => {
    const w = ctx.wedding;
    const blocked = needsUpgrade(w, 'The shared workspace');
    if (blocked) return blocked;

    const vendor = state.vendors.find((v) => v.id === body.vendorId);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    w.bookings = w.bookings || [];
    w.members = w.members || [];
    if (w.bookings.some((b) => b.vendorId === vendor.id && b.status === 'booked')) {
      return fail(409, `${vendor.businessName} is already booked for this wedding.`);
    }

    const existingBooking = w.bookings.find((b) => b.vendorId === vendor.id);
    const booking = existingBooking || {
      id: uid('bkg'), vendorId: vendor.id, category: vendor.category, createdAt: nowIso(),
    };
    booking.status = 'booked';
    booking.agreedPence = Number(body.agreedPence) || 0;
    booking.notes = String(body.notes || '');
    if (!existingBooking) w.bookings.push(booking);

    const existingMember = w.members.find((mem) => mem.vendorId === vendor.id);
    if (existingMember) existingMember.status = 'active';
    else {
      w.members.push({
        id: uid('mem'), userId: vendor.userId, vendorId: vendor.id, role: 'vendor',
        displayName: vendor.businessName, email: '', status: 'active', token: null,
      });
    }
    ensureOwner(w, currentUser());
    recordChange(w, vendor.businessName, 'vendor', 'was booked and joined the shared page');
    persist();

    return ok({
      booking: { id: booking.id, vendorId: vendor.id, category: booking.category, status: 'booked' },
      note: `${vendor.businessName} is booked and now has scoped access to your shared page. They can see your date, venue, guest count, their own budget line and the day timeline. They cannot see your total budget, your guest list or any other supplier's prices.`,
    }, 201);
  })],

  ['DELETE', /^\/api\/bookings\/([^/]+)$/, (m) => withCouple((ctx) => {
    const w = ctx.wedding;
    const booking = (w.bookings || []).find((b) => b.vendorId === m[1]);
    if (!booking) return fail(404, 'We could not find that booking.');
    booking.status = 'cancelled';
    const member = (w.members || []).find((mem) => mem.vendorId === m[1]);
    if (member) member.status = 'revoked';
    const vendor = state.vendors.find((v) => v.id === m[1]);
    recordChange(w, vendor ? vendor.businessName : 'A vendor', 'vendor', 'booking was cancelled and access removed');
    persist();
    return ok({ ok: true, note: 'The booking is cancelled and their access to your shared page was removed immediately.' });
  })],

  ['POST', /^\/api\/workspace\/([^/]+)\/tasks$/, (m, body) => {
    const access = accessFor(m[1]);
    if (!access) return fail(404, 'We could not find that wedding.');
    if (!access.can.includes('write_all') && !access.can.includes('write_plan')) {
      return fail(403, 'Only the couple and their planner can create tasks.');
    }
    access.wedding.wtasks = access.wedding.wtasks || [];
    access.wedding.wtasks.push({
      id: uid('wtk'), title: String(body.title || ''), detail: String(body.detail || ''),
      assigneeId: body.assigneeId || null, dueDate: body.dueDate || null, done: false,
    });
    recordChange(access.wedding, access.user.displayName, access.role, `added the task "${body.title}"`);
    persist();
    return ok({ ok: true }, 201);
  }],

  ['PATCH', /^\/api\/workspace\/([^/]+)\/tasks\/([^/]+)$/, (m, body) => {
    const access = accessFor(m[1]);
    if (!access) return fail(404, 'We could not find that wedding.');
    const task = (access.wedding.wtasks || []).find((t) => t.id === m[2]);
    if (!task) return fail(404, 'We could not find that task.');
    if (access.role === 'vendor') {
      if (task.assigneeId !== access.member.id) return fail(403, 'You can only update tasks assigned to you.');
      if (body.title !== undefined) return fail(403, 'Only the couple and their planner can change what a task says.');
    }
    if (body.done !== undefined) {
      task.done = Boolean(body.done);
      recordChange(access.wedding, access.user.displayName, access.role,
        `${task.done ? 'completed' : 'reopened'} "${task.title}"`);
    }
    if (body.title !== undefined) task.title = String(body.title);
    if (body.assigneeId !== undefined) task.assigneeId = body.assigneeId || null;
    persist();
    return ok({ ok: true });
  }],

  ['GET', /^\/api\/workspace\/([^/]+)\/comments$/, (m, body, url) => {
    const access = accessFor(m[1]);
    if (!access) return fail(404, 'We could not find that wedding.');
    const thread = url.searchParams.get('thread') || 'general';
    if (access.role === 'vendor' && thread !== `vendor:${access.member.vendorId}`) {
      return fail(403, 'You can only read your own thread on this wedding.');
    }
    return ok({ comments: commentsFor(access.wedding, thread), thread });
  }],

  ['POST', /^\/api\/workspace\/([^/]+)\/comments$/, (m, body) => {
    const access = accessFor(m[1]);
    if (!access) return fail(404, 'We could not find that wedding.');
    const thread = String(body.thread || 'general');
    if (access.role === 'vendor' && thread !== `vendor:${access.member.vendorId}`) {
      return fail(403, 'You can only post in your own thread on this wedding.');
    }
    const text = String(body.body || '').trim();
    if (!text) return fail(400, 'Comment is required.');
    access.wedding.wcomments = access.wedding.wcomments || [];
    const comment = {
      id: uid('cmt'), thread, author: access.user.displayName, role: access.role,
      body: text.slice(0, 4000), at: nowIso(),
    };
    access.wedding.wcomments.push(comment);
    persist();
    return ok({ comment }, 201);
  }],


  /* ---------------- verification console ---------------- */

  ['GET', /^\/api\/admin\/meta$/, () => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    return ok({
      checks: VERIFICATION_CHECKS, scope: VERIFICATION_SCOPE, categories: CATEGORIES,
      regions: REGIONS, insuranceChaseDays: INSURANCE_CHASE_DAYS,
      recheckIntervalDays: RECHECK_INTERVAL_DAYS,
      filters: ['all', 'not_started', 'in_progress', 'ready', 'verified', 'attention'],
      rule: 'The badge is derived from the six published checks plus a valid insurance certificate. There is no way to award it by hand, and it comes off on its own when a check lapses.',
    });
  }],

  ['GET', /^\/api\/admin\/queue$/, (m, body, url) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const filter = url.searchParams.get('filter') || 'all';
    const search = (url.searchParams.get('q') || '').toLowerCase();

    let rows = queueRows();
    if (search) {
      rows = rows.filter((r) => [r.businessName, r.town, r.slug].join(' ').toLowerCase().includes(search));
    }
    const counts = {
      all: rows.length,
      not_started: rows.filter((r) => r.state === 'not_started').length,
      in_progress: rows.filter((r) => r.state === 'in_progress').length,
      ready: rows.filter((r) => r.state === 'ready').length,
      verified: rows.filter((r) => r.state === 'verified').length,
      attention: rows.filter((r) => r.needsAttention).length,
    };
    const filtered = filter === 'all' ? rows
      : filter === 'attention' ? rows.filter((r) => r.needsAttention)
        : rows.filter((r) => r.state === filter);
    return ok({
      counts, vendors: filtered,
      filters: ['all', 'not_started', 'in_progress', 'ready', 'verified', 'attention'],
    });
  }],

  ['GET', /^\/api\/admin\/renewals$/, () => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const items = [];
    for (const vendor of state.vendors) {
      const insDays = vendor.insurance ? daysUntil(vendor.insurance.expiresOn) : null;
      if (insDays !== null && insDays <= INSURANCE_CHASE_DAYS) {
        items.push({
          vendorId: vendor.id, vendorName: vendor.businessName, vendorSlug: vendor.slug,
          kind: 'insurance', dueOn: vendor.insurance.expiresOn, daysRemaining: insDays,
          urgency: insDays < 0 ? 'lapsed' : insDays <= 14 ? 'urgent' : 'soon',
          detail: insDays < 0
            ? `Insurance lapsed on ${vendor.insurance.expiresOn}, so the badge has been removed`
            : `Insurance expires in ${insDays} days`,
          lastChasedAt: (vendor.chases || []).find((c) => c.kind === 'insurance')?.at || null,
        });
      }
      const reDays = daysUntil(vendor.recheckDueOn);
      if (reDays !== null && reDays <= INSURANCE_CHASE_DAYS) {
        items.push({
          vendorId: vendor.id, vendorName: vendor.businessName, vendorSlug: vendor.slug,
          kind: 'annual_recheck', dueOn: vendor.recheckDueOn, daysRemaining: reDays,
          urgency: reDays < 0 ? 'lapsed' : reDays <= 14 ? 'urgent' : 'soon',
          detail: reDays < 0 ? `The annual re-check was due on ${vendor.recheckDueOn}`
            : `The annual re-check is due in ${reDays} days`,
          lastChasedAt: (vendor.chases || []).find((c) => c.kind === 'annual_recheck')?.at || null,
        });
      }
    }
    const order = { lapsed: 0, urgent: 1, soon: 2 };
    items.sort((a, b) => order[a.urgency] - order[b.urgency] || a.daysRemaining - b.daysRemaining);
    return ok({
      renewals: items, chaseWindowDays: INSURANCE_CHASE_DAYS,
      note: 'A lapse should be a process failure we saw coming, not a surprise. Insurance expiries and annual re-checks appear here well before the date.',
    });
  }],

  ['GET', /^\/api\/admin\/audit$/, () => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const rows = [];
    for (const vendor of state.vendors) {
      for (const entry of vendor.audit || []) {
        rows.push({ ...entry, vendorId: vendor.id, vendorName: vendor.businessName, vendorSlug: vendor.slug });
      }
    }
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    return ok({ audit: rows.slice(0, 80) });
  }],

  ['GET', /^\/api\/admin\/vendors\/([^/]+)$/, (m) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    return ok({
      vendor: {
        id: vendor.id, slug: vendor.slug, businessName: vendor.businessName,
        category: vendor.category, region: vendor.region, town: vendor.town,
        tagline: vendor.tagline, verified: vendor.verified,
        badgeRemovedReason: vendor.badgeRemovedReason || '', isSample: vendor.isSample,
        hasAccount: Boolean(vendor.userId), accepting: vendor.accepting,
        startedAt: vendor.verificationStartedAt, rightsConfirmedAt: vendor.rightsConfirmedAt,
        adminNotes: vendor.adminNotes || '',
      },
      assessment: assess(vendor),
      chases: vendor.chases || [],
      audit: vendor.audit || [],
      images: (vendor.uploads || []).map((u) => ({ id: u.id, url: u.url, alt: u.alt, isHero: u.isHero })),
    });
  }],

  ['POST', /^\/api\/admin\/vendors\/([^/]+)\/checks\/([^/]+)$/, (m, body) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    const key = m[2];
    const definition = VERIFICATION_CHECKS.find((c) => c.key === key);
    if (!definition) return fail(400, 'That is not one of the published checks.');
    if (definition.drivenBy === 'insurance_record') {
      return fail(400, 'Insurance is set by recording a certificate with its expiry date, not by ticking a box.');
    }
    if (definition.drivenBy === 'rights_confirmation') {
      return fail(400, 'Portfolio rights is set when the vendor confirms in writing from their own account.');
    }
    const status = body.status;
    if (!['outstanding', 'passed', 'failed', 'not_applicable'].includes(status)) {
      return fail(400, 'That is not a valid outcome for a check.');
    }
    if (definition.requiresEvidence && status === 'passed' && !String(body.evidence || '').trim()) {
      return fail(400, `Record what you saw before passing ${definition.label.toLowerCase()}. ${definition.evidencePrompt}`);
    }

    ensureChecks(vendor);
    vendor.checks[key] = {
      status, evidence: String(body.evidence || '').slice(0, 2000),
      completedBy: status === 'outstanding' ? null : auth.user.displayName,
      completedAt: status === 'outstanding' ? null : nowIso(),
    };
    vAudit(vendor, `check.${status}`, `${definition.label}${body.evidence ? `: ${String(body.evidence).slice(0, 300)}` : ''}`, auth.user);
    const assessment = recompute(vendor, auth.user);
    return ok({
      assessment, verified: vendor.verified,
      note: assessment.shouldBeVerified
        ? 'Every published check is complete, so the badge has been awarded automatically.'
        : `The badge is not awarded yet. ${assessment.blockers[0]}`,
    });
  }],

  ['POST', /^\/api\/admin\/vendors\/([^/]+)\/insurance$/, (m, body) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresOn || ''))) {
      return fail(400, 'Record the expiry date from the certificate, in YYYY-MM-DD form.');
    }
    if (!String(body.insurer || '').trim()) return fail(400, 'Record which insurer issued the certificate.');

    vendor.insurance = {
      insurer: String(body.insurer).slice(0, 160), policyNumber: String(body.policyNumber || '').slice(0, 80),
      coverPence: Number(body.coverPence) || 0, expiresOn: body.expiresOn,
      sightedAt: isoDay(), indemnitySeen: Boolean(body.indemnitySeen),
    };
    ensureChecks(vendor);
    const insState = insuranceState(vendor);
    vendor.checks.insurance = {
      status: insState.valid ? 'passed' : 'outstanding',
      evidence: `${vendor.insurance.insurer}, expires ${vendor.insurance.expiresOn}`,
      completedBy: auth.user.displayName, completedAt: insState.valid ? nowIso() : null,
    };
    vAudit(vendor, 'insurance.recorded',
      `${vendor.insurance.insurer}, expires ${vendor.insurance.expiresOn}${vendor.insurance.indemnitySeen ? ', indemnity sighted' : ''}`,
      auth.user);
    const assessment = recompute(vendor, auth.user);
    return ok({
      assessment, insurance: assessment.insurance,
      note: assessment.insurance.valid
        ? `Recorded. We will start chasing the renewal ${INSURANCE_CHASE_DAYS} days before it expires.`
        : `Recorded, but it does not currently satisfy the check: ${assessment.insurance.label.toLowerCase()}.`,
    });
  }],

  ['POST', /^\/api\/admin\/vendors\/([^/]+)\/chase$/, (m, body) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    vendor.chases = vendor.chases || [];
    vendor.chases.unshift({
      id: uid('chs'), kind: body.kind || 'insurance', note: String(body.note || '').slice(0, 500),
      by: auth.user.displayName, at: nowIso(),
    });
    vAudit(vendor, 'renewal.chased', `${body.kind || 'insurance'}${body.note ? `: ${body.note}` : ''}`, auth.user);
    persist();
    return ok({
      chases: vendor.chases,
      note: 'Logged. Email delivery is not connected in this build, so send the message yourself and record what you said.',
    });
  }],

  ['POST', /^\/api\/admin\/vendors\/([^/]+)\/suspend$/, (m, body) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    const reason = String(body.reason || '').trim();
    if (!reason) return fail(400, 'Reason is required.');
    ensureChecks(vendor);
    vendor.checks.identity = {
      status: 'failed', evidence: `Suspended pending review: ${reason}`,
      completedBy: auth.user.displayName, completedAt: nowIso(),
    };
    vAudit(vendor, 'badge.suspended', reason, auth.user);
    const assessment = recompute(vendor, auth.user);
    return ok({
      assessment,
      note: 'The badge has been removed and the reason is on the record. Put the identity check back to passed once the review is finished.',
    });
  }],

  ['PATCH', /^\/api\/admin\/vendors\/([^/]+)\/notes$/, (m, body) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    vendor.adminNotes = String(body.notes || '').slice(0, 4000);
    vAudit(vendor, 'notes.updated', 'Internal notes edited', auth.user);
    persist();
    return ok({ ok: true });
  }],

  ['POST', /^\/api\/admin\/vendors\/([^/]+)\/recompute$/, (m) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    const assessment = recompute(vendor, auth.user);
    return ok({ assessment, verified: vendor.verified, badgeRemovedReason: vendor.badgeRemovedReason || '' });
  }],

  ['DELETE', /^\/api\/admin\/vendors\/([^/]+)\/images\/([^/]+)$/, (m) => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    const vendor = vendorById(m[1]);
    if (!vendor) return fail(404, 'We could not find that vendor.');
    const before = (vendor.uploads || []).length;
    vendor.uploads = (vendor.uploads || []).filter((u) => u.id !== m[2]);
    if (vendor.uploads.length === before) return fail(404, 'We could not find that image.');
    syncVendorGallery(vendor);
    vAudit(vendor, 'image.removed', 'Removed by staff', auth.user);
    persist();
    return ok({ removed: true, remaining: vendor.uploads.length });
  }],

  ['POST', /^\/api\/admin\/sweep$/, () => {
    const auth = requireAdminUser();
    if (auth.error) return auth.error;
    let removed = 0;
    for (const vendor of state.vendors) {
      const before = vendor.verified;
      recompute(vendor, null);
      if (before && !vendor.verified) removed += 1;
    }
    return ok({
      checked: state.vendors.length, removed,
      note: removed
        ? `${removed} badge${removed === 1 ? '' : 's'} removed because a published check is no longer satisfied.`
        : 'Every verified vendor still satisfies all six checks.',
    });
  }],

  /* ---------------- vendor media ---------------- */

  ['GET', /^\/api\/vendors\/me\/verification$/, () => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This is for vendor accounts.');
    const vendor = vendorOf(user.id);
    if (!vendor) return fail(404, 'Create your listing first.');
    const assessment = assess(vendor);
    return ok({
      verified: vendor.verified,
      badgeRemovedReason: vendor.badgeRemovedReason || '',
      completed: assessment.completed, total: assessment.total,
      recheckDueOn: assessment.recheckDueOn,
      rightsConfirmedAt: vendor.rightsConfirmedAt,
      rightsStatement: UPLOADS.rightsStatement,
      checks: assessment.checks.map((c) => ({
        key: c.key, label: c.label, status: c.status,
        yoursToDo: c.key === 'portfolio_rights',
        waitingOnUs: c.key !== 'portfolio_rights' && c.status === 'outstanding',
      })),
      insurance: {
        status: assessment.insurance.status, label: assessment.insurance.label,
        expiresOn: assessment.insurance.expiresOn || null,
        indemnityRequired: assessment.insurance.indemnityRequired,
      },
      note: 'AETERNA Verified is a set of checks our team completes. You cannot switch it on, and neither can we without completing them.',
    });
  }],

  ['POST', /^\/api\/vendors\/me\/rights$/, (m, body) => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This is for vendor accounts.');
    const vendor = vendorOf(user.id);
    if (!vendor) return fail(404, 'Create your listing first.');
    if (!body.confirmed) return fail(400, 'We need an explicit confirmation, so please tick the box.');
    if (body.statement !== UPLOADS.rightsStatement) {
      return fail(400, 'The confirmation wording did not match what was shown. Please reload and try again.');
    }
    ensureChecks(vendor);
    vendor.rightsConfirmedAt = nowIso();
    vendor.checks.portfolio_rights = {
      status: 'passed', evidence: 'Confirmed in writing by the vendor from their own account',
      completedBy: vendor.businessName, completedAt: nowIso(),
    };
    vAudit(vendor, 'rights.confirmed', 'The vendor confirmed image rights in writing', user);
    recompute(vendor, user);
    return ok({
      confirmedAt: vendor.rightsConfirmedAt,
      note: 'Recorded. That completes the portfolio rights check, and you can now upload images.',
    });
  }],


  ['POST', /^\/api\/vendors\/me\/images$/, async (m, body, url, init) => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This is for vendor accounts.');
    const vendor = vendorOf(user.id);
    if (!vendor) return fail(404, 'Create your listing first.');

    if (!vendor.rightsConfirmedAt) {
      return fail(403, 'Confirm that you hold the rights to your images before uploading. It takes one click and it is part of the published verification scope.',
        { reason: 'rights_not_confirmed', rightsStatement: UPLOADS.rightsStatement });
    }

    const alt = String(url.searchParams.get('alt') || '').replace(/[<>]/g, '').trim().slice(0, 200);
    if (alt.length < 4) {
      return fail(400, 'Describe the image in a few words. Alt text is what someone using a screen reader hears, and this is a public profile.');
    }

    vendor.uploads = vendor.uploads || [];
    if (vendor.uploads.length >= UPLOADS.maxImagesPerVendor) {
      return fail(409, `Profiles hold up to ${UPLOADS.maxImagesPerVendor} images. Remove one to add another.`);
    }

    const blob = init && init.body;
    if (!blob) return fail(400, 'No image data arrived with that request.');
    const size = blob.size ?? blob.byteLength ?? 0;
    if (size > UPLOADS.maxBytes) {
      return fail(413, `Images need to be under ${Math.round(UPLOADS.maxBytes / (1024 * 1024))}MB. Try exporting at a smaller size.`);
    }

    // Check the real file signature rather than trusting the declared type,
    // exactly as the server does.
    const bytes = new Uint8Array(await (blob.arrayBuffer ? blob.arrayBuffer() : Promise.resolve(blob)));
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) {
      return fail(415, 'That file is not a JPEG, PNG or WebP image. We check the file itself rather than trusting its name.');
    }
    const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp';

    // There is no disk in the demo, so the bytes are held as a data URL. The
    // real server writes the file and serves it from /uploads.
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob instanceof Blob ? blob : new Blob([bytes], { type: mime }));
    });

    const isHero = url.searchParams.get('hero') === '1' || vendor.uploads.length === 0;
    if (isHero) vendor.uploads.forEach((u) => { u.isHero = false; });

    const image = {
      id: uid('upl'), url: dataUrl, alt, isHero, bytes: size, mime, createdAt: nowIso(),
    };
    vendor.uploads.push(image);
    syncVendorGallery(vendor);
    vAudit(vendor, 'image.uploaded', `${alt} (${Math.round(size / 1024)}KB ${mime})`, user);
    persist();

    return ok({ image, images: vendor.uploads }, 201);
  }],

  ['GET', /^\/api\/vendors\/me\/images$/, () => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This is for vendor accounts.');
    const vendor = vendorOf(user.id);
    if (!vendor) return fail(404, 'Create your listing first.');
    return ok({
      images: vendor.uploads || [],
      maxImages: UPLOADS.maxImagesPerVendor,
      maxBytes: UPLOADS.maxBytes,
      accepts: UPLOADS.allowedMimes,
      rightsConfirmed: Boolean(vendor.rightsConfirmedAt),
    });
  }],

  ['PATCH', /^\/api\/vendors\/me\/images\/([^/]+)$/, (m, body) => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This is for vendor accounts.');
    const vendor = vendorOf(user.id);
    if (!vendor) return fail(404, 'Create your listing first.');
    const image = (vendor.uploads || []).find((u) => u.id === m[1]);
    if (!image) return fail(404, 'We could not find that image.');
    if (body.alt !== undefined) {
      const alt = String(body.alt).replace(/[<>]/g, '').trim().slice(0, 200);
      if (alt.length < 4) return fail(400, 'Alt text needs to describe the image in a few words.');
      image.alt = alt;
    }
    if (body.isHero) {
      vendor.uploads.forEach((u) => { u.isHero = false; });
      image.isHero = true;
    }
    syncVendorGallery(vendor);
    persist();
    return ok({ images: vendor.uploads });
  }],

  ['DELETE', /^\/api\/vendors\/me\/images\/([^/]+)$/, (m) => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This is for vendor accounts.');
    const vendor = vendorOf(user.id);
    if (!vendor) return fail(404, 'Create your listing first.');
    const removed = (vendor.uploads || []).find((u) => u.id === m[1]);
    if (!removed) return fail(404, 'We could not find that image.');
    vendor.uploads = vendor.uploads.filter((u) => u.id !== m[1]);
    if (removed.isHero && vendor.uploads.length) vendor.uploads[0].isHero = true;
    syncVendorGallery(vendor);
    vAudit(vendor, 'image.removed', removed.alt, user);
    persist();
    return ok({ removed: true, remaining: vendor.uploads.length, images: vendor.uploads });
  }],


  /* Demo affordance: claim a sample listing so its inbox can be explored. */
  ['POST', /^\/api\/vendors\/([^/]+)\/claim$/, (m) => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This action is for vendor accounts.');
    if (vendorOf(user.id)) return fail(409, 'This account already has a vendor profile.');
    const vendor = state.vendors.find((v) => v.slug === m[1]);
    if (!vendor) return fail(404, 'We could not find that listing.');
    if (vendor.userId) return fail(409, 'That listing is already claimed.');
    vendor.userId = user.id;
    persist();
    return ok({ vendor: publicVendor(vendor) });
  }],

  /* ---------------- vendor CRM ---------------- */

  ['GET', /^\/api\/crm\/pipeline$/, () => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This is for vendor accounts.');
    const vendor = vendorOf(user.id);
    if (!vendor) return fail(404, 'Create your listing first.');

    const cards = state.enquiries.filter((e) => e.vendorId === vendor.id).map((e) => {
      const w = state.weddings.find((x) => x.id === e.weddingId) || {};
      const quotes = (w.quotes || []).filter((q) => q.vendorId === vendor.id && q.enquiryId === e.id);
      const booking = (w.bookings || []).find((b) => b.vendorId === vendor.id && b.status === 'booked');
      let stage = e.pipelineStage || 'new';
      if (booking) stage = 'booked';
      else if (e.status === 'declined' || e.status === 'no_match') stage = 'closed_lost';
      else if (quotes.some((q) => q.status === 'sent') && stage === 'new') stage = 'quoted';
      return {
        enquiryId: e.id, weddingId: e.weddingId, reference: e.reference, category: e.category,
        status: e.status, stage, weddingDate: w.weddingDate, guestCount: w.guestCount,
        region: w.region, message: e.message, notes: e.vendorNotes || '',
        createdAt: e.createdAt, contactReleased: e.status === 'accepted' || Boolean(booking),
        quotes, booked: Boolean(booking), agreedPence: booking ? booking.agreedPence : null,
      };
    });
    return ok({
      stages: PIPELINE_STAGES.map((st) => ({ key: st.key, label: st.label, cards: cards.filter((c) => c.stage === st.key) })),
      total: cards.length, stageLabels: PIPELINE_STAGES,
    });
  }],

  ['PATCH', /^\/api\/crm\/enquiries\/([^/]+)$/, (m, body) => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    const enquiry = state.enquiries.find((e) => e.id === m[1] && vendor && e.vendorId === vendor.id);
    if (!enquiry) return fail(404, 'We could not find that enquiry.');
    if (body.stage !== undefined && PIPELINE_STAGE_KEYS.includes(body.stage)) enquiry.pipelineStage = body.stage;
    if (body.notes !== undefined) enquiry.vendorNotes = String(body.notes).slice(0, 4000);
    persist();
    return ok({ ok: true });
  }],

  ['POST', /^\/api\/crm\/quotes$/, (m, body) => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    if (!vendor) return fail(403, 'This is for vendor accounts.');
    const w = state.weddings.find((x) => x.id === body.weddingId);
    if (!w) return fail(404, 'We could not find that wedding.');
    const standing = state.enquiries.some((e) => e.weddingId === w.id && e.vendorId === vendor.id
      && ['awaiting_vendor', 'accepted'].includes(e.status))
      || (w.bookings || []).some((b) => b.vendorId === vendor.id && b.status === 'booked');
    if (!standing) return fail(403, 'You can only send a quote to a couple whose enquiry you hold or who has already booked you.');
    if (!(Number(body.amountPence) > 0)) return fail(400, 'A quote needs an amount.');

    w.quotes = w.quotes || [];
    const quote = {
      id: uid('qot'), weddingId: w.id, vendorId: vendor.id, enquiryId: body.enquiryId || null,
      title: String(body.title || '').slice(0, 160), description: String(body.description || '').slice(0, 4000),
      amountPence: Math.round(Number(body.amountPence)), status: 'sent',
      createdAt: nowIso(), decidedAt: null, vendorName: vendor.businessName,
    };
    w.quotes.push(quote);
    const enq = state.enquiries.find((e) => e.id === body.enquiryId);
    if (enq) enq.pipelineStage = 'quoted';
    recordChange(w, vendor.businessName, 'vendor', `sent a quote, "${quote.title.slice(0, 60)}"`);
    persist();
    return ok({ quote, note: 'Sent. The couple sees it on their shared page and decides there, so the agreement is on the record for both of you.' }, 201);
  }],

  ['POST', /^\/api\/quotes\/([^/]+)\/decide$/, (m, body) => withCouple((ctx) => {
    const w = ctx.wedding;
    const quote = (w.quotes || []).find((q) => q.id === m[1]);
    if (!quote) return fail(404, 'We could not find that quote.');
    if (quote.status !== 'sent') return fail(409, 'That quote has already been decided.');
    const vendor = state.vendors.find((v) => v.id === quote.vendorId);

    if (body.decision === 'decline') {
      quote.status = 'declined';
      quote.decidedAt = nowIso();
      recordChange(w, currentUser().displayName, 'owner', `declined ${vendor.businessName}'s quote`);
      persist();
      return ok({ quote, booking: null, note: 'Declined. The vendor can see the decision and nothing else changes.' });
    }

    quote.status = 'approved';
    quote.decidedAt = nowIso();
    // Approval creates the booking, exactly as on the server.
    w.bookings = w.bookings || [];
    w.members = w.members || [];
    let booking = w.bookings.find((b) => b.vendorId === vendor.id);
    if (!booking) {
      booking = { id: uid('bkg'), vendorId: vendor.id, category: vendor.category, createdAt: nowIso() };
      w.bookings.push(booking);
    }
    booking.status = 'booked';
    booking.agreedPence = quote.amountPence;
    booking.notes = `Approved quote: ${quote.title}`;
    if (!w.members.some((mem) => mem.vendorId === vendor.id)) {
      w.members.push({
        id: uid('mem'), userId: vendor.userId, vendorId: vendor.id, role: 'vendor',
        displayName: vendor.businessName, email: '', status: 'active', token: null,
      });
    } else {
      w.members.find((mem) => mem.vendorId === vendor.id).status = 'active';
    }
    const enq = state.enquiries.find((e) => e.id === quote.enquiryId);
    if (enq) enq.pipelineStage = 'booked';
    recordChange(w, currentUser().displayName, 'owner', `approved ${vendor.businessName}'s quote for "${quote.title}"`);
    persist();
    return ok({ quote, booking, note: 'Approved. The vendor is booked at the quoted amount and has joined your shared page, scoped to their own work.' });
  })],

  ['GET', /^\/api\/crm\/invoices$/, () => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    if (!vendor) return fail(403, 'This is for vendor accounts.');
    const invoices = [];
    for (const w of state.weddings) {
      for (const inv of (w.invoices || []).filter((i) => i.vendorId === vendor.id)) {
        invoices.push({ ...inv, couple: [w.partnerOne, w.partnerTwo].filter(Boolean).join(' and ') || 'A couple' });
      }
    }
    return ok({
      invoices,
      owedPence: invoices.filter((i) => i.status === 'unpaid').reduce((sum, i) => sum + i.amountPence, 0),
      collectedPence: invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.amountPence, 0),
    });
  }],

  ['POST', /^\/api\/crm\/invoices$/, (m, body) => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    if (!vendor) return fail(403, 'This is for vendor accounts.');
    const w = state.weddings.find((x) => x.id === body.weddingId);
    if (!w || !(w.bookings || []).some((b) => b.vendorId === vendor.id && b.status === 'booked')) {
      return fail(403, 'Invoices can only be raised against a wedding that has booked you.');
    }
    if (!(Number(body.amountPence) > 0)) return fail(400, 'An invoice needs an amount.');
    w.invoices = w.invoices || [];
    const invoice = {
      id: uid('inv2'), weddingId: w.id, vendorId: vendor.id,
      reference: `INV-${1001 + w.invoices.length}`,
      description: String(body.description || '').slice(0, 500),
      amountPence: Math.round(Number(body.amountPence)), dueOn: body.dueOn || null,
      status: 'unpaid', createdAt: nowIso(), paidAt: null, vendorName: vendor.businessName,
    };
    w.invoices.push(invoice);
    recordChange(w, vendor.businessName, 'vendor', `raised invoice ${invoice.reference}`);
    persist();
    return ok({ invoice, note: 'Raised. The couple sees it on their shared page. This tracks what is owed, it does not take the payment.' }, 201);
  }],

  ['PATCH', /^\/api\/crm\/invoices\/([^/]+)$/, (m, body) => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    for (const w of state.weddings) {
      const invoice = (w.invoices || []).find((i) => i.id === m[1] && vendor && i.vendorId === vendor.id);
      if (invoice) {
        invoice.status = ['paid', 'unpaid', 'void'].includes(body.status) ? body.status : invoice.status;
        invoice.paidAt = invoice.status === 'paid' ? nowIso() : null;
        if (invoice.status === 'paid') recordChange(w, vendor.businessName, 'vendor', `marked invoice ${invoice.reference} as paid`);
        persist();
        return ok({ invoice });
      }
    }
    return fail(404, 'We could not find that invoice.');
  }],

  ['GET', /^\/api\/crm\/availability$/, () => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    if (!vendor) return fail(403, 'This is for vendor accounts.');
    return ok({
      blackouts: vendor.blackouts || [],
      note: 'A date you block out never receives an enquiry. It is a hard filter in the router, not a preference.',
    });
  }],

  ['POST', /^\/api\/crm\/availability$/, (m, body) => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    if (!vendor) return fail(403, 'This is for vendor accounts.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) return fail(400, 'Dates take the YYYY-MM-DD form.');
    vendor.blackouts = vendor.blackouts || [];
    if (!vendor.blackouts.some((b) => b.date === body.date)) {
      vendor.blackouts.push({ id: uid('blk'), date: body.date, note: String(body.note || '').slice(0, 200) });
      vendor.blackouts.sort((a, b) => a.date.localeCompare(b.date));
    }
    persist();
    return ok({ blackouts: vendor.blackouts }, 201);
  }],

  ['DELETE', /^\/api\/crm\/availability\/([^/]+)$/, (m) => {
    const user = currentUser();
    const vendor = user ? vendorOf(user.id) : null;
    if (!vendor) return fail(403, 'This is for vendor accounts.');
    vendor.blackouts = (vendor.blackouts || []).filter((b) => b.id !== m[1]);
    persist();
    return ok({ blackouts: vendor.blackouts });
  }],

  /* ---------------- sharing matrix ---------------- */

  ['GET', /^\/api\/workspace\/([^/]+)\/sharing$/, (m) => {
    const access = accessFor(m[1]);
    if (!access || access.role !== 'owner') return fail(403, 'Only the couple decides who sees what.');
    const w = access.wedding;
    w.sharing = w.sharing || { defaults: {}, perVendor: {} };
    return ok({
      defaults: { ...SHARING_DEFAULTS, ...(w.sharing.defaults || {}) },
      perVendor: w.sharing.perVendor || {},
      keys: SHARING_KEYS.map((key) => ({ key, ...SHARING_LABELS[key] })),
      neverShared: ['What other vendors are charging. This is not a setting, it is a rule.'],
    });
  }],

  ['PATCH', /^\/api\/workspace\/([^/]+)\/sharing$/, (m, body) => {
    const access = accessFor(m[1]);
    if (!access || access.role !== 'owner') return fail(403, 'Only the couple decides who sees what.');
    const w = access.wedding;
    w.sharing = w.sharing || { defaults: {}, perVendor: {} };
    const clean = (input) => {
      const out = {};
      for (const key of SHARING_KEYS) if (typeof (input || {})[key] === 'boolean') out[key] = input[key];
      return out;
    };
    if (body.defaults) Object.assign(w.sharing.defaults, clean(body.defaults));
    if (body.vendorId && body.overrides) {
      w.sharing.perVendor[body.vendorId] = { ...(w.sharing.perVendor[body.vendorId] || {}), ...clean(body.overrides) };
    }
    recordChange(w, currentUser().displayName, 'owner', 'changed who can see what');
    persist();
    return ok({ sharing: w.sharing });
  }],

  /* ---------------- guest messaging and RSVP ---------------- */

  ['POST', /^\/api\/planner\/guest-messages$/, (m, body) => withCouple((ctx) => {
    const w = ctx.wedding;
    const audience = ['all', 'yes', 'pending'].includes(body.audience) ? body.audience : 'all';
    w.messages = w.messages || [];
    w.messages.unshift({ id: uid('gms'), subject: String(body.subject || ''), body: String(body.body || ''), audience, at: nowIso() });
    const guests = w.guests.filter((g) => audience === 'all' || g.rsvp === (audience === 'yes' ? 'yes' : 'pending'));
    const recipients = guests.map((g) => {
      g.rsvpToken = g.rsvpToken || uid('rt') + uid('rt');
      const rsvpUrl = `${location.origin}${location.pathname}#/rsvp/${g.rsvpToken}`;
      const text = `${body.body}\n\nReply here: ${rsvpUrl}`;
      return {
        guestId: g.id, name: g.name, rsvp: g.rsvp, rsvpUrl,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`Hi ${g.name.split(' ')[0]}, ${text}`)}`,
        mailto: `mailto:?subject=${encodeURIComponent(body.subject || '')}&body=${encodeURIComponent(`Hi ${g.name.split(' ')[0]},\n\n${text}`)}`,
      };
    });
    persist();
    return ok({
      recipients,
      note: 'Email delivery is not connected in this build, so each guest has a WhatsApp and a mail link carrying your message and their personal reply page. Send them from your own phone or inbox.',
    }, 201);
  })],

  ['GET', /^\/api\/planner\/guest-messages$/, () => withCouple((ctx) => ok({ messages: ctx.wedding.messages || [] }))],

  ['GET', /^\/api\/planner\/guest-links$/, () => withCouple((ctx) => ok({
    guests: ctx.wedding.guests.map((g) => {
      g.rsvpToken = g.rsvpToken || uid('rt') + uid('rt');
      return { id: g.id, name: g.name, rsvp: g.rsvp, rsvpUrl: `${location.origin}${location.pathname}#/rsvp/${g.rsvpToken}` };
    }),
  }))],

  ['GET', /^\/api\/rsvp\/([^/]+)$/, (m) => {
    for (const w of state.weddings) {
      const guest = (w.guests || []).find((g) => g.rsvpToken === m[1]);
      if (guest) {
        return ok({
          guestName: guest.name, rsvp: guest.rsvp, dietary: guest.dietary, note: guest.rsvpNote || '',
          couple: [w.partnerOne, w.partnerTwo].filter(Boolean).join(' and ') || 'The couple',
          weddingDate: w.weddingDate, region: w.region,
        });
      }
    }
    return fail(404, 'This reply link is not valid. Check with the couple for a fresh one.');
  }],

  ['POST', /^\/api\/rsvp\/([^/]+)$/, (m, body) => {
    for (const w of state.weddings) {
      const guest = (w.guests || []).find((g) => g.rsvpToken === m[1]);
      if (guest) {
        if (!['yes', 'no'].includes(body.rsvp)) return fail(400, 'Reply must be yes or no.');
        guest.rsvp = body.rsvp;
        guest.dietary = String(body.dietary || '').slice(0, 200);
        guest.rsvpNote = String(body.note || '').slice(0, 500);
        recordChange(w, guest.name, 'helper', body.rsvp === 'yes' ? 'replied yes to the invitation' : 'sent apologies');
        persist();
        return ok({
          saved: true, rsvp: body.rsvp,
          note: body.rsvp === 'yes'
            ? 'Lovely, you are on the list. You can come back to this page and change your reply if plans shift.'
            : 'Thank you for letting them know. You can come back and change this if plans shift.',
        });
      }
    }
    return fail(404, 'This reply link is not valid. Check with the couple for a fresh one.');
  }],

  /* ---------------- billing ---------------- */

  ['POST', /^\/api\/billing\/couple\/upgrade$/, () => withCouple((ctx) => {
    if (ctx.wedding.upgraded) return fail(409, 'This wedding is already upgraded. The upgrade is paid once.');
    ctx.wedding.upgraded = true;
    persist();
    return ok({
      upgraded: true, amountPence: 4900, recurring: false, paymentProcessed: false,
      note: 'No payment was taken. Card processing is not connected in this build.',
    }, 201);
  })],

  ['POST', /^\/api\/billing\/vendor\/subscribe$/, () => {
    const user = currentUser();
    if (!user || user.role !== 'vendor') return fail(403, 'This action is for vendor accounts.');
    const trialUntil = new Date(Date.now() + PRICING.vendor.trialDays * 864e5).toISOString();
    return ok({
      plan: 'founding', pricePence: PRICING.vendor.foundingPricePence,
      trialUntil, paymentProcessed: false,
      note: `Your first month is free, so nothing is due until ${trialUntil.slice(0, 10)}. No payment was taken, card processing is not connected in this build.`,
    }, 201);
  }],
];

function withCouple(fn) {
  let ctx;
  try { ctx = requireCouple(); } catch (e) { return fail(e.status, e.message); }
  return fn(ctx);
}

function publicVendor(v) {
  const category = CATEGORIES.find((c) => c.slug === v.category);
  return {
    id: v.id, slug: v.slug, businessName: v.businessName, category: v.category,
    categoryLabel: category ? category.label : v.category, region: v.region, town: v.town,
    tagline: v.tagline, priceFromPence: v.priceFromPence, heroImage: v.heroImage, heroAlt: v.heroAlt,
    verified: v.verified, accepting: v.accepting, isSample: v.isSample,
  };
}

/* ------------------------------------------------------------------ */
/* install                                                             */
/* ------------------------------------------------------------------ */

const realFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input.url;
  if (!raw || !raw.includes('/api/')) return realFetch(input, init);

  const url = new URL(raw, location.origin);
  const method = (init.method || 'GET').toUpperCase();
  let body = {};
  if (init.body) { try { body = JSON.parse(init.body); } catch { body = {}; } }

  // A short delay so loading states are visible rather than flashing.
  await new Promise((resolve) => setTimeout(resolve, 90));

  for (const [verb, pattern, handler] of handlers) {
    if (verb !== method) continue;
    const match = url.pathname.match(pattern);
    if (!match) continue;
    try {
      return await handler(match, body, url, init);
    } catch (error) {
      return fail(500, 'Something went wrong in the demo backend.');
    }
  }
  return fail(404, 'That endpoint does not exist.');
};

for (const role of ['owner', 'planner']) {
  if (!WORKSPACE_ROLES[role].can.includes('comment')) WORKSPACE_ROLES[role].can.push('comment');
}

// A staff account so the console can be opened in the demo, and verification
// records behind every seeded badge so none of them is an unsupported claim.
if (!state.users.some((u) => u.role === 'admin')) {
  state.users.push({
    id: uid('usr'), email: 'admin@aeterna.co.uk', password: 'verify-the-checks',
    role: 'admin', displayName: 'AETERNA verification team',
  });
}
if (!seededVerification) { seedVerification(); seededVerification = true; }

window.AETERNA_DEMO_BACKEND = true;
