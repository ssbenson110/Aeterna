/**
 * Headless smoke test for the front end.
 *
 * There is no browser and no test framework in this environment, so this script
 * installs a small DOM shim, imports the real view modules unmodified, and
 * renders every view against the real running server. It catches the failures
 * that matter: runtime errors during render, views that produce nothing, and
 * broken API contracts between the client and the server.
 *
 * Usage:  node scripts/smoke-views.mjs            (expects the server on :4173)
 */

const BASE = process.env.AETERNA_BASE || 'http://localhost:4173';

/* ------------------------------------------------------------------ */
/* DOM shim                                                            */
/* ------------------------------------------------------------------ */

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...names) { names.forEach((n) => n && this.set.add(n)); this.sync(); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); this.sync(); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name); else this.set.delete(name);
    this.sync();
    return on;
  }
  sync() { this.node.attributes.class = [...this.set].join(' '); }
}

class Node2 {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = new Proxy({ setProperty() {} }, { get: (t, k) => t[k] ?? '', set: (t, k, v) => { t[k] = v; return true; } });
    this.listeners = {};
    this._text = '';
    this.classList = new ClassList(this);
    this.parentNode = null;
  }

  set className(value) { this.attributes.class = value; this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this.attributes.class || ''; }

  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }

  set innerHTML(value) { this._text = String(value).replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this._text; }

  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return name in this.attributes; }

  append(...nodes) {
    for (const n of nodes) {
      if (n === null || n === undefined) continue;
      const node = n instanceof Node2 ? n : textNode(String(n));
      node.parentNode = this;
      if (node.tagName === '#fragment') this.children.push(...node.children);
      else this.children.push(node);
    }
  }
  prepend(...nodes) { const before = this.children; this.children = []; this.append(...nodes); this.children.push(...before); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  removeChild(node) { this.children = this.children.filter((c) => c !== node); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }

  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach((fn) => fn(event)); return true; }
  focus() {}
  scrollIntoView() {}
  click() { this.dispatchEvent({ type: 'click', preventDefault() {}, target: this }); }

  descendants() {
    const out = [];
    const walk = (node) => { for (const child of node.children) { out.push(child); walk(child); } };
    walk(this);
    return out;
  }

  matchesSelector(selector) {
    const s = selector.trim();
    if (s.startsWith('#')) return this.attributes.id === s.slice(1);
    if (s.startsWith('.')) return this.classList.contains(s.slice(1));
    if (s.includes('[')) {
      const [tag, rest] = s.split('[');
      const attr = rest.replace(']', '').split('=')[0].replace(/["']/g, '');
      const tagOk = !tag || this.tagName === tag.toUpperCase();
      return tagOk && attr in this.attributes;
    }
    return this.tagName === s.toUpperCase();
  }

  querySelector(selector) {
    const parts = selector.split(',').map((p) => p.trim());
    return this.descendants().find((n) => parts.some((p) => n.matchesSelector(p))) || null;
  }
  querySelectorAll(selector) {
    const parts = selector.split(',').map((p) => p.trim());
    return this.descendants().filter((n) => parts.some((p) => n.matchesSelector(p)));
  }
  closest(selector) {
    const parts = selector.split(',').map((p) => p.trim());
    let node = this;
    while (node) { if (parts.some((p) => node.matchesSelector(p))) return node; node = node.parentNode; }
    return null;
  }
}

function textNode(text) { const n = new Node2('#text'); n._text = text; return n; }

const doc = new Node2('#document');
doc.createElement = (tag) => new Node2(tag);
doc.createElementNS = (ns, tag) => new Node2(tag);
doc.createTextNode = (text) => textNode(text);
doc.createDocumentFragment = () => new Node2('#fragment');
doc.body = new Node2('body');
doc.head = new Node2('head');
doc.documentElement = new Node2('html');
doc.activeElement = null;
const registry = new Map();
doc.getElementById = (id) => registry.get(id) || null;
doc.querySelector = (s) => (s.startsWith('#') ? registry.get(s.slice(1)) || null : doc.body.querySelector(s));
doc.querySelectorAll = (s) => doc.body.querySelectorAll(s);
doc.addEventListener = () => {};
doc.append = (...n) => doc.body.append(...n);

for (const id of ['main', 'toasts', 'nav-account']) {
  const node = new Node2('div');
  node.attributes.id = id;
  registry.set(id, node);
  doc.body.append(node);
}

const storage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  scrollTo: () => {},
  location: { hash: '#/', origin: BASE },
  parent: null,
};
globalThis.document = doc;
globalThis.Node = Node2;
globalThis.localStorage = storage();
globalThis.sessionStorage = storage();
globalThis.FormData = class FormData {
  constructor(form) {
    this.map = new Map();
    for (const node of form.descendants()) {
      const name = node.attributes.name;
      if (!name) continue;
      if (node.attributes.type === 'checkbox' && !node.attributes.checked) continue;
      this.map.set(name, node.value ?? node.attributes.value ?? '');
    }
  }
  entries() { return this.map.entries(); }
};
globalThis.history = { replaceState: () => {}, pushState: () => {} };

// A minimal real PNG, built here so the upload tests exercise the magic byte
// sniffing rather than a hand waved fixture.
function tinyPng() {
  const zlib = require_('node:zlib');
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(4 * (1 + 4 * 3));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}
const { createRequire } = await import('node:module');
const require_ = createRequire(import.meta.url);
const PNG = tinyPng();
globalThis.location = globalThis.window.location;

// Route relative API calls at the running server and keep the session cookie.
const realFetch = globalThis.fetch;
let cookie = '';
globalThis.fetch = async (input, init = {}) => {
  const url = String(input).startsWith('http') ? String(input) : BASE + String(input);
  const headers = { ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await realFetch(url, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  for (const entry of setCookie) cookie = entry.split(';')[0];
  return response;
};

/* ------------------------------------------------------------------ */
/* run                                                                 */
/* ------------------------------------------------------------------ */

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push([true, name, '']); })
    .catch((error) => { results.push([false, name, error && error.message]); });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 260));

function assertRendered(node, name, mustInclude = []) {
  if (!node || !(node instanceof Node2)) throw new Error(`${name} did not return a DOM node`);
  const text = node.textContent;
  if (text.trim().length < 40) throw new Error(`${name} rendered almost no text (${text.length} chars)`);
  for (const needle of mustInclude) {
    if (!text.includes(needle)) throw new Error(`${name} is missing expected copy: "${needle}"`);
  }
}

const { store } = await import('../public/js/store.js');
const home = await import('../public/js/views/home.js');
const browse = await import('../public/js/views/browse.js');
const vendorView = await import('../public/js/views/vendor.js');
const planner = await import('../public/js/views/planner.js');
const chat = await import('../public/js/views/chat.js');
const pricing = await import('../public/js/views/pricing.js');
const forVendors = await import('../public/js/views/for-vendors.js');
const policies = await import('../public/js/views/policies.js');
const account = await import('../public/js/views/account.js');
const workspaceView = await import('../public/js/views/workspace.js');
const adminView = await import('../public/js/views/admin.js');
const { api } = await import('../public/js/api.js');

await store.boot();

await check('store boots with reference data', () => {
  if (!store.meta || !store.meta.categories.length) throw new Error('categories missing');
  if (!store.pricing || store.pricing.vendor.foundingPricePence !== 2900) throw new Error('founding price wrong');
  if (store.pricing.couple.upgradePricePence !== 4900) throw new Error('couple upgrade price wrong');
});

await check('the taxonomy is exhaustive and the map covers the UK', () => {
  const meta = store.meta;
  if (meta.categories.length < 40) throw new Error(`only ${meta.categories.length} categories`);
  if (!meta.categories.some((c) => c.catchAll)) throw new Error('no catch-all category, so a vendor could be turned away');
  if (meta.regions.length < 60) throw new Error(`only ${meta.regions.length} regions`);
  if (!meta.regionGroups || meta.regionGroups.length < 9) throw new Error('region groups missing');
  const names = meta.regionGroups.map((g) => g.label);
  for (const nation of ['Scotland', 'Wales', 'Northern Ireland']) {
    if (!names.includes(nation)) throw new Error(`${nation} is missing from the map`);
  }
  // The original beachhead areas must survive, or existing data breaks.
  for (const legacy of ['South London', 'Kent', 'West Kent', 'East Kent']) {
    if (!meta.regions.includes(legacy)) throw new Error(`legacy region ${legacy} was dropped`);
  }
  if (!meta.tableShapes || meta.tableShapes.length < 4) throw new Error('table shapes missing');
  if (store.pricing.vendor.trialDays !== 30) throw new Error('the first month free offer is missing');
});

await check('tradition search is loose, not a closed list', async () => {
  // "yoruba" should find the vendor who logged "Yoruba traditional".
  const partial = await api.vendors({ tradition: 'yoruba' });
  if (!partial.vendors.length) throw new Error('a partial tradition search found nothing');
  // And a longer phrase should still match a shorter logged tradition.
  const phrase = await api.vendors({ tradition: 'nikah ceremony at the mosque' });
  if (!phrase.vendors.length) throw new Error('a phrase containing a logged tradition found nothing');
});

await check('home renders the positioning line and pricing', () => {
  assertRendered(home.renderHome(), 'home', [
    'one private AI planner',
    'one verified vendor',
    'Wedding Reality Plan',
    '£29',
    'no paid ranking',
  ]);
});

await check('browse renders and lists vendors', async () => {
  const node = browse.renderBrowse();
  await settle();
  assertRendered(node, 'browse', ['Position is never sold']);
  if (!node.textContent.includes('Assembly Hall Croydon')) throw new Error('sample vendors not listed');
});

await check('vendor profile renders with the verified badge linked to the scope', async () => {
  const node = vendorView.renderVendor('croydon-assembly-hall');
  await settle();
  assertRendered(node, 'vendor', ['AETERNA Verified', 'one vendor']);
  const badge = node.querySelectorAll('a').find((a) => a.attributes.href === '#/verification');
  if (!badge) throw new Error('verified badge does not link to the published scope');
});

await check('pricing renders both audiences with the exact prices', () => {
  const node = pricing.renderPricing();
  const text = node.textContent;
  assertRendered(node, 'pricing', ['£29', '£49', 'not a subscription']);
  if (/£19|£99|£149|Premium|Pro plan|Enterprise/.test(text)) throw new Error('an invented tier appeared on pricing');
});

await check('for vendors renders the model', () => {
  assertRendered(forVendors.renderForVendors(), 'for-vendors', ['one vendor', 'lead', '£29']);
});

await check('verification scope page renders every published check', async () => {
  const node = policies.renderVerification();
  await settle();
  assertRendered(node, 'verification', ['Identity', 'Insurance', 'References', 'Portfolio rights', 'Video call', 'Annual re-checks']);
  if (/personally vetted/i.test(node.textContent)) throw new Error('the page claims personal vetting');
});

await check('fair use page renders published allowances', async () => {
  const node = policies.renderFairUse();
  await settle();
  assertRendered(node, 'fair-use', ['20 planner messages', '400 planner messages']);
  // The word may appear, but only while denying the claim. An affirmative use fails.
  for (const match of node.textContent.matchAll(/unlimited/gi)) {
    const context = node.textContent.slice(Math.max(0, match.index - 60), match.index).toLowerCase();
    if (!/\b(not|never|rather than|without)\b/.test(context)) {
      throw new Error(`the page appears to claim unlimited AI: "...${context.slice(-50)}unlimited..."`);
    }
  }
});

await check('planner shows the free intake before sign in', () => {
  assertRendered(planner.renderPlanner(), 'planner intake', ['Wedding Reality Plan', 'free account']);
});

await check('chat shows the signed out preview', () => {
  assertRendered(chat.renderChat(), 'chat signed out', ['already knows your wedding']);
});

/* ---- signed in journey ---- */

const email = `smoke-${Date.now()}@example.com`;

await check('a couple can register', async () => {
  await api.register({ email, password: 'plan-my-wedding', role: 'couple', displayName: 'Smoke Test' });
  await store.refresh();
  if (!store.user) throw new Error('no session after registering');
});

await check('wedding details save and the budget splits', async () => {
  const plan = await api.updateWedding({
    weddingDate: '2027-06-12', budgetPence: 2400000, guestCount: 140,
    region: 'South London', traditions: ['Hindu ceremony', 'Nigerian traditional'],
  });
  await api.rebalanceBudget();
  if (plan.checklist.length < 20) throw new Error('checklist template did not seed');
  const fresh = await api.planner();
  const venue = fresh.budget.find((b) => b.category === 'Venue and catering');
  if (venue.plannedPence !== 960000) throw new Error(`venue split wrong: ${venue.plannedPence}`);
});

await check('the saved planner renders all tabs', async () => {
  const node = planner.renderPlanner();
  await settle();
  assertRendered(node, 'planner', ['Checklist', 'Budget', 'Guests', 'Seating', 'Timeline', 'Enquiries']);
});

await check('the AI planner answers using the wedding context', async () => {
  const result = await api.aiChat('How should we split the budget and what do our traditions need from a venue?');
  if (!result.reply || result.reply.length < 120) throw new Error('planner reply too short');
  if (!/£9,600|£24,000/.test(result.reply)) throw new Error('planner did not use the real budget');
  if (!/mandap|havan/i.test(result.reply)) throw new Error('planner ignored the couple traditions');
  if (result.reply.includes('—')) throw new Error('planner reply contains an em dash');
  if (result.reply.includes('!')) throw new Error('planner reply contains an exclamation mark');
  if (!['live', 'offline'].includes(result.mode)) throw new Error('planner mode not reported');
});

await check('the chat view renders the conversation', async () => {
  const node = chat.renderChat();
  await settle();
  assertRendered(node, 'chat', ['What the planner can see', 'fair use']);
});

await check('an enquiry goes to exactly one vendor', async () => {
  const result = await api.sendEnquiry({ category: 'venues', message: 'Two ceremonies over one weekend.' });
  if (result.routing.vendorsContacted !== 1) throw new Error('more than one vendor was contacted');
  if (result.enquiry.sharedWithOtherVendors !== false) throw new Error('enquiry marked as shared');
  if (!result.enquiry.routedReason) throw new Error('no routing explanation given');
});

await check('the free plan stops at one enquiry', async () => {
  try {
    await api.sendEnquiry({ category: 'photography' });
    throw new Error('a second enquiry was allowed on the free plan');
  } catch (error) {
    if (error.status !== 402) throw new Error(`expected 402, got ${error.status}`);
    if (!/free plan includes 1 enquiry/i.test(error.message)) {
      throw new Error(`the refusal did not explain the cap: ${error.message}`);
    }
  }
});

await check('free tier caps block the upgrade only features', async () => {
  const cases = [
    ['guests', () => api.addGuest({ name: 'Test Guest' })],
    ['seating', () => api.addTable({ name: 'Table 9', capacity: 8 })],
    ['timeline', () => api.addTimelineEvent({ time: '10:00', title: 'Test' })],
  ];
  for (const [name, call] of cases) {
    try {
      await call();
      throw new Error(`${name} was allowed on the free plan`);
    } catch (error) {
      if (error.status !== 402) throw new Error(`${name}: expected 402, got ${error.status}`);
    }
  }
});

await check('a custom tradition survives the round trip and reaches matching', async () => {
  const plan = await api.updateWedding({
    traditions: ['Hindu ceremony'],
    customTraditions: ['Ijaw boat procession', '  Hindu ceremony  ', '<script>bad</script>'],
  });
  const all = plan.wedding.allTraditions;
  if (!all.includes('Ijaw boat procession')) throw new Error('the custom tradition was dropped');
  if (all.filter((t) => t.toLowerCase() === 'hindu ceremony').length !== 1) {
    throw new Error('a custom entry duplicated a preset');
  }
  if (all.some((t) => t.includes('<') || t.includes('>'))) throw new Error('markup was not stripped');
});

await check('upgrading unlocks the capped features', async () => {
  await api.upgrade();
  await api.addGuest({ name: 'Ada Obi' });
  await api.addTimelineEvent({ time: '14:30', title: 'Baraat arrives' });
  const plan = await api.planner();
  if (plan.entitlements.plan !== 'upgraded') throw new Error('still on the free plan after upgrading');
  if (!plan.guests.length) throw new Error('the guest was not saved');
  if (plan.entitlements.ai.quota !== 400) throw new Error('the planner allowance did not rise');
});

await check('the seating designer: shapes, moves and honest capacity limits', async () => {
  await api.addTable({ name: 'Banquet one', shape: 'rectangle', capacity: 12 });
  let plan = await api.planner();
  const table = plan.seating.tables.find((t) => t.name === 'Banquet one');
  if (!table) throw new Error('the table was not created');
  if (table.shape !== 'rectangle') throw new Error(`shape not stored: ${table.shape}`);

  // Move it, reshape it, and check the position survives the round trip.
  await api.updateTable(table.id, { x: 55.5, y: 30.2 });
  await api.updateTable(table.id, { shape: 'round' });
  plan = await api.planner();
  const moved = plan.seating.tables.find((t) => t.id === table.id);
  if (Math.abs(moved.x - 55.5) > 0.2 || Math.abs(moved.y - 30.2) > 0.2) {
    throw new Error(`position lost: ${moved.x}, ${moved.y}`);
  }
  if (moved.shape !== 'round') throw new Error('reshape did not stick');

  // A round table cannot hold 30 people, and the API should say so.
  try {
    await api.updateTable(table.id, { capacity: 30 });
    throw new Error('an impossible seat count was accepted');
  } catch (error) {
    if (error.status !== 400) throw new Error(`expected 400, got ${error.status}`);
  }

  // Seat someone, then refuse to shrink the table beneath them.
  const guest = plan.guests[0];
  await api.updateGuest(guest.id, { tableId: table.id });
  try {
    await api.updateTable(table.id, { capacity: 2 });
    const after = await api.planner();
    const seated = after.seating.tables.find((t) => t.id === table.id).seated;
    if (seated > 2) throw new Error('the table shrank beneath its seated guests');
  } catch (error) {
    if (error.status && error.status !== 409) throw new Error(`expected 409, got ${error.status}`);
  }
});

await check('the seating tab renders a draggable room with shaped tables', async () => {
  window.location.hash = '#/planner?tab=seating';
  const node = planner.renderPlanner();
  await settle();
  window.location.hash = '#/';
  assertRendered(node, 'seating designer', ['Drag tables to arrange the room', 'Shape', 'Add table']);
  const room = node.querySelector('.seating-room');
  if (!room) throw new Error('no seating room canvas rendered');
  const tables = node.querySelectorAll('.stable');
  if (!tables.length) throw new Error('no table nodes rendered in the room');
  // Shapes must reach the DOM as classes, or every table draws identically.
  const classes = tables.map((t) => t.className).join(' ');
  if (!/stable--(round|rectangle|square|head|oval)/.test(classes)) {
    throw new Error('table shapes are not reflected in the rendered room');
  }
  // Positions must reach the DOM as inline percentages.
  if (!tables.some((t) => String(t.attributes.style || '').includes('%'))) {
    throw new Error('table positions are not applied to the canvas');
  }
});

await check('a duplicate live enquiry is still refused once upgraded', async () => {
  try {
    await api.sendEnquiry({ category: 'venues' });
    throw new Error('a duplicate live enquiry was allowed');
  } catch (error) {
    if (error.status !== 409) throw new Error(`expected 409, got ${error.status}`);
  }
});

await check('account view renders for a couple', () => {
  assertRendered(account.renderAccount(), 'account', ['Your account']);
});

/* ---- the shared workspace, and the boundary it must hold ---- */

const couple = { email, password: 'plan-my-wedding' };
const bookedVendor = { email: `smoke-booked-${Date.now()}@example.com`, password: 'one-flat-fee-please' };
const otherVendor = { email: `smoke-other-${Date.now()}@example.com`, password: 'one-flat-fee-please' };

const signInAs = async (who) => { cookie = ''; await api.login({ email: who.email, password: who.password }); };

let weddingId = null;
let bookedVendorId = null;

await check('the couple is a member of their own wedding', async () => {
  const plan = await api.planner();
  weddingId = plan.wedding.id;
  const view = await api.workspace(weddingId);
  if (view.scope !== 'owner') throw new Error(`expected owner scope, got ${view.scope}`);
  if (!view.members.some((m) => m.role === 'owner')) throw new Error('the couple is not listed as a member');
});

await check('a vendor can create their own listing', async () => {
  cookie = '';
  await api.register({ ...bookedVendor, role: 'vendor', displayName: 'Smoke Catering' });
  const created = await api.createVendor({
    businessName: `Smoke Catering ${Date.now()}`,
    category: 'catering',
    region: 'South London',
    town: 'Peckham',
    priceFromPence: 300000,
  });
  bookedVendorId = created.vendor.id;
  if (created.vendor.verified) throw new Error('a new listing must not be verified on creation');
  // The rollout offer: subscribing gives the first month free, automatically.
  const sub = await api.subscribe();
  if (!sub.trialUntil) throw new Error('no free first month on the subscription');
  if (new Date(sub.trialUntil).getTime() < Date.now() + 25 * 864e5) {
    throw new Error('the trial is shorter than a month');
  }
});

await check('a vendor anywhere in the UK has a place', async () => {
  cookie = '';
  await api.register({
    email: `smoke-glasgow-${Date.now()}@example.com`,
    password: 'one-flat-fee-please', role: 'vendor', displayName: 'Clyde Pipers',
  });
  const created = await api.createVendor({
    businessName: `Clyde Pipers ${Date.now()}`,
    category: 'other-services',
    region: 'Glasgow and the West',
    town: 'Glasgow',
  });
  if (created.vendor.region !== 'Glasgow and the West') throw new Error('a Scottish region was rejected');
  if (created.vendor.category !== 'other-services') throw new Error('the catch-all category was rejected');
});

await check('a vendor with no booking cannot reach the wedding', async () => {
  try {
    await api.workspace(weddingId);
    throw new Error('an unbooked vendor reached the shared page');
  } catch (error) {
    if (error.status !== 404) throw new Error(`expected 404, got ${error.status}`);
  }
});

await check('booking is what grants a vendor access', async () => {
  await signInAs(couple);
  const result = await api.bookVendor({ vendorId: bookedVendorId, agreedPence: 500000 });
  if (!result.booking) throw new Error('no booking was created');

  await signInAs(bookedVendor);
  const view = await api.workspace(weddingId);
  if (view.scope !== 'vendor') throw new Error(`expected vendor scope, got ${view.scope}`);
});

await check('a booked vendor sees only their own slice', async () => {
  const view = await api.workspace(weddingId);
  if (view.wedding.budgetPence !== undefined) throw new Error('the total budget leaked to a vendor');
  if (view.budgetSummary !== undefined) throw new Error('the budget summary leaked to a vendor');
  if (view.guestSummary !== undefined) throw new Error('the guest list leaked to a vendor');
  if (view.bookings !== undefined) throw new Error("other vendors' bookings leaked");
  if (view.members !== undefined) throw new Error('the full member list leaked to a vendor');
  if (!view.yourBooking) throw new Error('the vendor cannot see their own booking');
  if (view.yourBooking.agreedPence !== 500000) throw new Error('the vendor cannot see their own fee');
  if (view.wedding.guestCount === undefined) throw new Error('the vendor needs the headcount and cannot see it');
});

await check('the vendor workspace view renders', async () => {
  const node = workspaceView.renderWorkspace(weddingId);
  await settle();
  assertRendered(node, 'vendor workspace', ['Your booking', 'What is not shared with you']);
});

await check('a booked vendor cannot post in the general thread', async () => {
  try {
    await api.addWorkspaceComment(weddingId, { thread: 'general', body: 'peeking' });
    throw new Error('a vendor posted in the general thread');
  } catch (error) {
    if (error.status !== 403) throw new Error(`expected 403, got ${error.status}`);
  }
});

await check('a booked vendor can post in their own thread', async () => {
  const result = await api.addWorkspaceComment(weddingId, {
    thread: `vendor:${bookedVendorId}`, body: 'Tasting confirmed for the 14th.',
  });
  if (result.comment.role !== 'vendor') throw new Error('the comment was not attributed to the vendor');
});

await check('a different vendor cannot read that thread', async () => {
  cookie = '';
  await api.register({ ...otherVendor, role: 'vendor', displayName: 'Unbooked Co' });
  await api.createVendor({
    businessName: `Unbooked Co ${Date.now()}`, category: 'djs', region: 'South London',
  });
  try {
    await api.workspace(weddingId);
    throw new Error('an unbooked vendor reached the shared page');
  } catch (error) {
    if (error.status !== 404) throw new Error(`expected 404, got ${error.status}`);
  }
});

await check('the couple workspace view renders with the booking', async () => {
  await signInAs(couple);
  const node = workspaceView.renderWorkspace(weddingId);
  await settle();
  assertRendered(node, 'couple workspace', ['Booked vendors', 'People on this page', 'The day, hour by hour']);
});

await check('inviting a planner works and vendors cannot be invited by email', async () => {
  const invite = await api.inviteToWorkspace(weddingId, {
    email: `planner-${Date.now()}@example.com`, role: 'planner', displayName: 'A Planner',
  });
  if (!invite.inviteUrl) throw new Error('no invite link was returned');
  try {
    await api.inviteToWorkspace(weddingId, { email: 'v@example.com', role: 'vendor' });
    throw new Error('a vendor was invited by email, bypassing the booking gate');
  } catch (error) {
    if (error.status !== 400) throw new Error(`expected 400, got ${error.status}`);
  }
});

await check('cancelling a booking removes access immediately', async () => {
  await api.cancelBooking(bookedVendorId);
  await signInAs(bookedVendor);
  try {
    await api.workspace(weddingId);
    throw new Error('a cancelled vendor still has access');
  } catch (error) {
    if (error.status !== 404) throw new Error(`expected 404, got ${error.status}`);
  }
});

/* ---- the CRM, approvals, sharing, messaging ---- */

await check('the quote to approval to booking flow works end to end', async () => {
  // The booked vendor from earlier holds an accepted enquiry context; use a
  // fresh pair to keep this self contained.
  const c2 = { email: `smoke-c2-${Date.now()}@example.com`, password: 'plan-my-wedding' };
  const v2 = { email: `smoke-v2-${Date.now()}@example.com`, password: 'one-flat-fee-please' };

  cookie = '';
  await api.register({ ...c2, role: 'couple', displayName: 'Quote Couple' });
  await api.updateWedding({ budgetPence: 2000000, guestCount: 100, region: 'South London', weddingDate: '2027-09-04' });
  await api.upgrade();
  const enquiryResult = await api.sendEnquiry({ category: 'catering', message: 'Quote flow test.' });
  const routedVendorSlug = enquiryResult.enquiry.vendor.slug;
  const c2Wedding = (await api.planner()).wedding.id;

  // The routed vendor's owner signs in (claim the sample listing).
  cookie = '';
  await api.register({ ...v2, role: 'vendor', displayName: 'Quote Vendor' });
  const claim = await fetch(`/api/vendors/${routedVendorSlug}/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  if (!claim.ok) throw new Error(`could not claim the routed listing: ${claim.status}`);

  const pipeline = await api.crmPipeline();
  const card = pipeline.stages.flatMap((st) => st.cards).find((cd) => cd.weddingId === c2Wedding);
  if (!card) throw new Error('the enquiry did not appear on the vendor pipeline');

  const sent = await api.crmSendQuote({
    weddingId: card.weddingId, enquiryId: card.enquiryId,
    title: 'Full wedding catering', description: 'Three courses, staff included.', amountPence: 480000,
  });
  if (sent.quote.status !== 'sent') throw new Error('the quote did not send');

  // A quote to a stranger wedding must be refused.
  try {
    await api.crmSendQuote({ weddingId, title: 'Spam quote', amountPence: 100 });
    throw new Error('a quote to a wedding with no enquiry was allowed');
  } catch (error) {
    if (error.status !== 403) throw new Error(`expected 403, got ${error.status}`);
  }

  // The couple approves on the page, which books the vendor at that amount.
  await signInAs(c2);
  const view = await api.workspace(c2Wedding);
  const pending = (view.quotes || []).filter((q) => q.status === 'sent');
  if (!pending.length) throw new Error('the quote is not on the shared page');
  const decided = await api.decideQuote(pending[0].id, 'approve');
  if (!decided.booking) throw new Error('approval did not create a booking');
  if (decided.booking.agreed_pence !== 480000 && decided.booking.agreedPence !== 480000) {
    throw new Error('the booking does not carry the quoted amount');
  }

  // The vendor now has workspace access and can raise an invoice.
  await signInAs(v2);
  const invoice = await api.crmRaiseInvoice({
    weddingId: c2Wedding, description: 'Deposit', amountPence: 120000, dueOn: '2027-01-15',
  });
  if (invoice.invoice.status !== 'unpaid') throw new Error('the invoice did not raise');

  // And the couple sees it on the shared page.
  await signInAs(c2);
  const after = await api.workspace(c2Wedding);
  if (!(after.invoices || []).some((i) => i.reference === invoice.invoice.reference)) {
    throw new Error('the invoice is not visible to the couple');
  }

  // Sharing matrix: budget hidden by default, shown once shared.
  let vendorView;
  await signInAs(v2);
  vendorView = await api.workspace(c2Wedding);
  if (vendorView.sharedByCouple && vendorView.sharedByCouple.budgetTotalPence !== undefined) {
    throw new Error('the budget leaked before the couple shared it');
  }
  await signInAs(c2);
  await api.setSharing(c2Wedding, { defaults: { budget_total: true } });
  await signInAs(v2);
  vendorView = await api.workspace(c2Wedding);
  if (vendorView.sharedByCouple.budgetTotalPence !== 2000000) {
    throw new Error('the shared budget did not reach the vendor');
  }
  // And per vendor override wins over the default.
  await signInAs(c2);
  const myVendorId = (await api.workspace(c2Wedding)).bookings[0].vendorId;
  await api.setSharing(c2Wedding, { vendorId: myVendorId, overrides: { budget_total: false } });
  await signInAs(v2);
  vendorView = await api.workspace(c2Wedding);
  if (vendorView.sharedByCouple.budgetTotalPence !== undefined) {
    throw new Error('the per vendor override did not win');
  }
  await signInAs(c2);

  /* guest messaging and the public RSVP round trip */
  await api.addGuest({ name: 'Funke Ade', side: 'Both' });
  const send = await api.sendGuestMessage({ subject: 'Save the date', body: 'We are getting married.', audience: 'all' });
  if (!send.recipients.length) throw new Error('no recipients came back');
  const recipient = send.recipients.find((r) => r.name === 'Funke Ade');
  if (!recipient.whatsapp.includes('wa.me') || !recipient.rsvpUrl.includes('/rsvp/')) {
    throw new Error('the send links are malformed');
  }

  const token = recipient.rsvpUrl.split('/rsvp/')[1];
  cookie = ''; // the guest has no account, deliberately
  const invitation = await api.rsvpGet(token);
  if (invitation.guestName !== 'Funke Ade') throw new Error('the RSVP page shows the wrong guest');
  const reply = await api.rsvpPost(token, { rsvp: 'yes', dietary: 'Halal', note: 'Cannot wait.' });
  if (!reply.saved) throw new Error('the RSVP did not save');

  await signInAs(c2);
  const plan2 = await api.planner();
  const funke = plan2.guests.find((g) => g.name === 'Funke Ade');
  if (funke.rsvp !== 'yes' || funke.dietary !== 'Halal') {
    throw new Error('the public RSVP did not land in the guest list');
  }

  await signInAs(couple);
});

await check('a blacked out date never receives an enquiry', async () => {
  // Block the wedding date on every cake vendor except one, then enquire and
  // confirm routing lands on the available one.
  const c3 = { email: `smoke-c3-${Date.now()}@example.com`, password: 'plan-my-wedding' };
  cookie = '';
  await api.register({ ...c3, role: 'couple', displayName: 'Blackout Couple' });
  await api.updateWedding({ budgetPence: 1500000, guestCount: 80, region: 'South West London', weddingDate: '2027-10-09' });
  await api.upgrade();

  const cakes = await api.vendors({ category: 'cakes-and-desserts' });
  if (cakes.vendors.length !== 1) {
    // The seed has exactly one cake vendor; if that changes this test needs rethinking.
    throw new Error(`expected one cake vendor in the seed, found ${cakes.vendors.length}`);
  }
  const cakeSlug = cakes.vendors[0].slug;

  const vb = { email: `smoke-vb-${Date.now()}@example.com`, password: 'one-flat-fee-please' };
  cookie = '';
  await api.register({ ...vb, role: 'vendor', displayName: 'Cake Owner' });
  const claim = await fetch(`/api/vendors/${cakeSlug}/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  if (!claim.ok) throw new Error('could not claim the cake listing');
  await api.crmAddBlackout({ date: '2027-10-09', note: 'Another wedding' });

  await signInAs(c3);
  try {
    await api.sendEnquiry({ category: 'cakes-and-desserts' });
    throw new Error('an enquiry was routed to a vendor blacked out on that date');
  } catch (error) {
    if (error.status !== 409) throw new Error(`expected 409 no-match, got ${error.status}`);
  }
  await signInAs(couple);
});

await check('billing reports itself honestly when Stripe is not configured', async () => {
  const status = await api.billingStatus();
  if (status.stripe.configured) return; // keys present in this environment, fine
  await signInAs(couple);
  try {
    await api.coupleCheckout();
    throw new Error('checkout succeeded with no Stripe keys');
  } catch (error) {
    if (error.status !== 503) throw new Error(`expected 503, got ${error.status}`);
    if (error.body.reason !== 'stripe_not_configured') throw new Error('the refusal is not machine readable');
  }
  if (status.email.mode === 'outbox' && status.email.configured) {
    throw new Error('email claims configured while in outbox mode');
  }
});

await check('an invitation email lands in the outbox when no provider is set', async () => {
  const status = await api.billingStatus();
  if (status.email.configured) return; // a real provider is set, nothing to assert here
  await signInAs(couple);
  const plan = await api.planner();
  const invite = await api.inviteToWorkspace(plan.wedding.id, {
    email: `outbox-check-${Date.now()}@example.com`, role: 'helper', displayName: 'Outbox Check',
  });
  if (invite.emailSent) throw new Error('emailSent is true in outbox mode, which is a lie');
  if (!/outbox|share the link/i.test(invite.emailNote)) {
    throw new Error(`the note does not explain the fallback: ${invite.emailNote}`);
  }
  const fs = require_('node:fs');
  const path = require_('node:path');
  const outbox = path.join(process.cwd(), 'data', 'outbox');
  if (!fs.existsSync(outbox) || !fs.readdirSync(outbox).length) {
    throw new Error('nothing was written to the outbox');
  }
  const latest = fs.readdirSync(outbox).sort().pop();
  const message = JSON.parse(fs.readFileSync(path.join(outbox, latest), 'utf8'));
  if (!message.subject.includes('invited')) throw new Error('the outboxed email is not the invitation');
});

/* ---- the verification console ---- */

const admin = { email: 'admin@aeterna.co.uk', password: 'verify-the-checks' };
const freshVendor = { email: `smoke-verify-${Date.now()}@example.com`, password: 'one-flat-fee-please' };
let freshVendorId = null;

await check('a new listing is never verified on creation', async () => {
  cookie = '';
  await api.register({ ...freshVendor, role: 'vendor', displayName: 'Smoke Verify Co' });
  const created = await api.createVendor({
    businessName: `Smoke Verify Co ${Date.now()}`,
    category: 'decor-and-florals',
    region: 'South London',
  });
  freshVendorId = created.vendor.id;
  if (created.vendor.verified) throw new Error('a self created listing came out verified');
});

await check('a vendor cannot reach the console', async () => {
  try {
    await api.adminQueue({});
    throw new Error('a vendor reached the admin console');
  } catch (error) {
    if (error.status !== 403) throw new Error(`expected 403, got ${error.status}`);
  }
});

await check('a couple cannot reach the console either', async () => {
  await signInAs(couple);
  try {
    await api.adminQueue({});
    throw new Error('a couple reached the admin console');
  } catch (error) {
    if (error.status !== 403) throw new Error(`expected 403, got ${error.status}`);
  }
});

await check('staff can open the queue and it counts real states', async () => {
  await signInAs(admin);
  const data = await api.adminQueue({ filter: 'all' });
  if (!data.vendors.length) throw new Error('the queue is empty');
  if (data.counts.verified + data.counts.in_progress + data.counts.not_started + data.counts.ready !== data.counts.all) {
    throw new Error('the state counts do not add up to the total');
  }
});

await check('passing a check without evidence is refused', async () => {
  try {
    await api.adminSetCheck(freshVendorId, 'identity', { status: 'passed', evidence: '   ' });
    throw new Error('a check passed with no evidence recorded');
  } catch (error) {
    if (error.status !== 400) throw new Error(`expected 400, got ${error.status}`);
  }
});

await check('insurance cannot be passed by ticking a box', async () => {
  try {
    await api.adminSetCheck(freshVendorId, 'insurance', { status: 'passed', evidence: 'saw it' });
    throw new Error('insurance was passed without a certificate');
  } catch (error) {
    if (error.status !== 400) throw new Error(`expected 400, got ${error.status}`);
    if (!/expiry date/i.test(error.message)) throw new Error('the refusal did not explain why');
  }
});

await check('portfolio rights cannot be passed by staff', async () => {
  try {
    await api.adminSetCheck(freshVendorId, 'portfolio_rights', { status: 'passed' });
    throw new Error('staff passed the rights check on the vendor\'s behalf');
  } catch (error) {
    if (error.status !== 400) throw new Error(`expected 400, got ${error.status}`);
  }
});

await check('THE CORE RULE: the badge is not awarded while any check is outstanding', async () => {
  for (const key of ['identity', 'references', 'video_call']) {
    await api.adminSetCheck(freshVendorId, key, {
      status: 'passed', evidence: 'Recorded during the smoke test',
    });
  }
  const dossier = await api.adminVendor(freshVendorId);
  if (dossier.vendor.verified) throw new Error('the badge was awarded with checks outstanding');
  if (!dossier.assessment.blockers.length) throw new Error('no blockers were reported');
  // There is deliberately no endpoint that could force it, so prove that too.
  if (typeof api.adminAwardBadge === 'function') {
    throw new Error('an award-badge shortcut exists, which defeats the whole design');
  }
});

await check('the badge is awarded only once every check is satisfied', async () => {
  // The vendor gives the rights confirmation themselves.
  await signInAs(freshVendor);
  const status = await api.myVerification();
  await api.confirmRights(status.rightsStatement);

  await signInAs(admin);
  const result = await api.adminRecordInsurance(freshVendorId, {
    insurer: 'Hiscox', policyNumber: 'PL-SMOKE-1', coverPence: 500000000,
    expiresOn: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10),
    indemnitySeen: true,
  });
  if (!result.assessment.shouldBeVerified) {
    throw new Error(`still not verified: ${result.assessment.blockers.join('; ')}`);
  }
  const dossier = await api.adminVendor(freshVendorId);
  if (!dossier.vendor.verified) throw new Error('the badge was not awarded when everything passed');
  if (!dossier.assessment.recheckDueOn) throw new Error('no annual re-check date was set');
});

await check('expired insurance removes the badge on its own', async () => {
  await api.adminRecordInsurance(freshVendorId, {
    insurer: 'Hiscox', policyNumber: 'PL-SMOKE-1', coverPence: 500000000,
    expiresOn: '2026-01-01', indemnitySeen: true,
  });
  const dossier = await api.adminVendor(freshVendorId);
  if (dossier.vendor.verified) throw new Error('the badge survived an expired certificate');
  if (!/insurance/i.test(dossier.vendor.badgeRemovedReason)) {
    throw new Error(`the reason does not mention insurance: ${dossier.vendor.badgeRemovedReason}`);
  }
});

await check('the vendor is told plainly why the badge is not showing', async () => {
  await signInAs(freshVendor);
  const status = await api.myVerification();
  if (status.verified) throw new Error('the vendor still shows as verified');
  if (!status.badgeRemovedReason) throw new Error('no reason was given to the vendor');
  const mine = status.checks.filter((c) => c.yoursToDo);
  if (mine.length !== 1 || mine[0].key !== 'portfolio_rights') {
    throw new Error('the vendor is not told which single check is theirs to complete');
  }
});

await check('the audit trail records the award and the removal', async () => {
  await signInAs(admin);
  const dossier = await api.adminVendor(freshVendorId);
  const actions = dossier.audit.map((a) => a.action);
  if (!actions.includes('badge.awarded')) throw new Error('the award was not recorded');
  if (!actions.includes('badge.removed')) throw new Error('the removal was not recorded');
  if (!actions.includes('rights.confirmed')) throw new Error('the rights confirmation was not recorded');
  if (dossier.audit.some((a) => !a.actor)) throw new Error('an audit entry has no actor');
});

await check('the renewals list surfaces expiries before they lapse', async () => {
  const data = await api.adminRenewals();
  if (!Array.isArray(data.renewals)) throw new Error('no renewals list returned');
  if (!data.renewals.some((r) => r.vendorId === freshVendorId && r.kind === 'insurance')) {
    throw new Error('the lapsed certificate is not on the renewals list');
  }
  const lapsed = data.renewals.find((r) => r.vendorId === freshVendorId);
  if (lapsed.urgency !== 'lapsed') throw new Error(`expected lapsed urgency, got ${lapsed.urgency}`);
});

await check('the sweep re-derives badges and cannot force one on', async () => {
  const result = await api.adminSweep();
  if (typeof result.checked !== 'number') throw new Error('the sweep reported nothing');
  const dossier = await api.adminVendor(freshVendorId);
  if (dossier.vendor.verified) throw new Error('the sweep awarded a badge it should not have');
});

await check('the console view renders', async () => {
  await store.refresh();
  const node = adminView.renderAdmin();
  await settle();
  await settle();
  assertRendered(node, 'admin console', ['AETERNA Verified', 'derived']);
});

/* ---- uploads ---- */

await check('a vendor who has not confirmed rights cannot upload', async () => {
  cookie = '';
  const noRights = { email: `smoke-norights-${Date.now()}@example.com`, password: 'one-flat-fee-please' };
  await api.register({ ...noRights, role: 'vendor', displayName: 'No Rights Co' });
  await api.createVendor({ businessName: `No Rights ${Date.now()}`, category: 'djs', region: 'Kent' });
  try {
    await api.uploadImage(PNG, 'image/png', 'A photo of the decks', true);
    throw new Error('an upload was accepted without a rights confirmation');
  } catch (error) {
    if (error.status !== 403) throw new Error(`expected 403, got ${error.status}`);
  }
});

await check('a real image uploads, and alt text is required', async () => {
  await signInAs(freshVendor);
  try {
    await api.uploadImage(PNG, 'image/png', 'x', false);
    throw new Error('an image was accepted with unusable alt text');
  } catch (error) {
    if (error.status !== 400) throw new Error(`expected 400 for short alt text, got ${error.status}`);
  }
  const result = await api.uploadImage(PNG, 'image/png', 'Peony and eucalyptus table centrepiece', true);
  if (!result.image.url.startsWith('/uploads/')) throw new Error('no upload URL returned');
  if (!result.image.isHero) throw new Error('the first image should become the main image');
});

await check('a file that is not really an image is refused', async () => {
  const notAnImage = Buffer.from('<?php echo "hello"; ?> definitely not a png', 'utf8');
  try {
    await api.uploadImage(notAnImage, 'image/png', 'Trying it on with a fake header', false);
    throw new Error('a non image was accepted because it claimed to be a PNG');
  } catch (error) {
    if (error.status !== 415) throw new Error(`expected 415, got ${error.status}`);
  }
});

await check('an oversized image is refused', async () => {
  const huge = Buffer.concat([PNG, Buffer.alloc(7 * 1024 * 1024)]);
  try {
    await api.uploadImage(huge, 'image/png', 'A very large file indeed', false);
    throw new Error('an oversized image was accepted');
  } catch (error) {
    if (![413, 415].includes(error.status)) throw new Error(`expected 413, got ${error.status}`);
  }
});

await check('an uploaded image replaces stock imagery on the public profile', async () => {
  await signInAs(freshVendor);
  const me = await api.me();
  const profile = await api.vendor(me.vendor.slug);
  if (!profile.vendor.heroImage.startsWith('/uploads/')) {
    throw new Error(`the public hero is not the vendor's own image: ${profile.vendor.heroImage}`);
  }
  if (!profile.vendor.gallery.every((g) => g.url.startsWith('/uploads/'))) {
    throw new Error('the gallery still mixes in stock imagery');
  }
  if (profile.vendor.gallery.some((g) => !g.alt)) throw new Error('a public image has no alt text');
});

await check('staff can remove an image a vendor should not be showing', async () => {
  await signInAs(admin);
  const dossier = await api.adminVendor(freshVendorId);
  if (!dossier.images.length) throw new Error('the dossier does not show the uploaded image');
  const result = await api.adminRemoveImage(freshVendorId, dossier.images[0].id);
  if (!result.removed) throw new Error('the image was not removed');
  const after = await api.adminVendor(freshVendorId);
  if (after.audit[0].action !== 'image.removed') throw new Error('the removal was not audited');
});

/* ---- output ---- */

const failed = results.filter(([passed]) => !passed);
for (const [passed, name, message] of results) {
  process.stdout.write(`${passed ? '  ok  ' : ' FAIL '} ${name}${message ? `\n        ${message}` : ''}\n`);
}
process.stdout.write(`\n${results.length - failed.length} of ${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
