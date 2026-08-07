#!/usr/bin/env node
'use strict';

/**
 * Builds a single self contained HTML file.
 *
 * The application source is unchanged. The build inlines the stylesheet, bundles
 * the ES modules in dependency order, and prepends the demo backend so the whole
 * product can be explored without the Node server running.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist', 'aeterna-demo.html');

const images = require('../server/lib/images');
const config = require('../server/lib/config');
const { SAMPLE_VENDORS } = require('../server/lib/seed');
const { CHECKLIST_TEMPLATE, TIMELINE_TEMPLATE } = require('../server/lib/templates');

/* ------------------------------------------------------------------ */
/* module bundling                                                     */
/* ------------------------------------------------------------------ */

// Dependency order, leaves first. Kept explicit so the output is deterministic.
const MODULE_ORDER = [
  'js/api.js',
  'js/ui.js',
  'js/store.js',
  'js/router.js',
  'js/components.js',
  'js/views/home.js',
  'js/views/browse.js',
  'js/views/vendor.js',
  'js/views/planner.js',
  'js/views/chat.js',
  'js/views/pricing.js',
  'js/views/for-vendors.js',
  'js/views/policies.js',
  'js/views/account.js',
  'js/views/workspace.js',
  'js/views/crm.js',
  'js/views/rsvp.js',
  'js/views/vendor-media.js',
  'js/views/admin.js',
  'js/app.js',
];

/**
 * Strips import and export syntax so the modules can be concatenated into one
 * classic script. Every module in this project uses named top level exports and
 * static imports, so this is safe and the result is inspectable.
 */
function flatten(source, file) {
  let out = source;

  // Remove static imports entirely. Everything ends up in one shared scope.
  out = out.replace(/^\s*import\s+[^;]*?from\s*['"][^'"]+['"]\s*;?\s*$/gm, '');
  out = out.replace(/^\s*import\s*['"][^'"]+['"]\s*;?\s*$/gm, '');

  // Dynamic import of a local module becomes a resolved promise of the scope.
  out = out.replace(/import\(\s*['"][^'"]+['"]\s*\)/g, 'Promise.resolve(window.__AETERNA_SCOPE__)');

  // export const/function/class -> plain declaration, then register on scope.
  const exported = [];
  out = out.replace(/^\s*export\s+(async\s+)?(const|let|var|function|class)\s+([A-Za-z0-9_$]+)/gm,
    (match, asyncKeyword, kind, name) => {
      exported.push(name);
      return match.replace(/^\s*export\s+/, '');
    });

  // export { a, b } -> register only.
  out = out.replace(/^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm, (match, names) => {
    for (const part of names.split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) exported.push(name);
    }
    return '';
  });

  if (/^\s*export\s+default/m.test(out)) {
    throw new Error(`${file} uses a default export, which this bundler does not handle.`);
  }

  const registrations = exported.length
    ? `\n${exported.map((name) => `window.__AETERNA_SCOPE__.${name} = ${name};`).join('\n')}\n`
    : '';

  return `/* ---- ${file} ---- */\n${out.trim()}\n${registrations}`;
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

const css = fs.readFileSync(path.join(PUBLIC, 'css', 'aeterna.css'), 'utf8');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const demoBackend = fs.readFileSync(path.join(PUBLIC, 'js', 'demo-backend.js'), 'utf8')
  .replace(/^\s*\/\* eslint-disable[^\n]*\n/m, '');

const bundle = MODULE_ORDER
  .map((file) => flatten(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), file))
  .join('\n\n');

/*
 * The demo backend reads its taxonomy, pricing, entitlements and published
 * policies from the real server config rather than keeping its own copy. That
 * is deliberate: a second hand copy would drift, and the demo would end up
 * claiming something the real product does not do.
 */
const fixtures = `
window.AETERNA_CONFIG = ${JSON.stringify({
  PRICING: config.PRICING,
  FREE_LIMITS: config.FREE_LIMITS,
  UPGRADED_LIMITS: config.UPGRADED_LIMITS,
  CATEGORIES: config.CATEGORIES,
  CATEGORY_FAMILIES: config.CATEGORY_FAMILIES,
  CATEGORY_BUDGET_SHARE: config.CATEGORY_BUDGET_SHARE,
  REGIONS: config.REGIONS,
  REGION_GROUPS: config.REGION_GROUPS,
  REGION_GROUP_NEIGHBOURS: config.REGION_GROUP_NEIGHBOURS,
  TABLE_SHAPES: config.TABLE_SHAPES,
  TABLE_SHAPE_KEYS: config.TABLE_SHAPE_KEYS,
  PIPELINE_STAGES: config.PIPELINE_STAGES,
  PIPELINE_STAGE_KEYS: config.PIPELINE_STAGE_KEYS,
  SHARING_DEFAULTS: config.SHARING_DEFAULTS,
  SHARING_KEYS: config.SHARING_KEYS,
  SHARING_LABELS: config.SHARING_LABELS,
  SUPPLY_CAP: config.SUPPLY_CAP,
  TRADITIONS: config.TRADITIONS,
  TRADITION_GROUPS: config.TRADITION_GROUPS,
  MAX_CUSTOM_TRADITION_LENGTH: config.MAX_CUSTOM_TRADITION_LENGTH,
  WORKSPACE_ROLES: config.WORKSPACE_ROLES,
  VERIFICATION_CHECKS: config.VERIFICATION_CHECKS,
  VERIFICATION_CHECK_KEYS: config.VERIFICATION_CHECK_KEYS,
  RECHECK_INTERVAL_DAYS: config.RECHECK_INTERVAL_DAYS,
  INSURANCE_CHASE_DAYS: config.INSURANCE_CHASE_DAYS,
  INDEMNITY_CATEGORIES: config.INDEMNITY_CATEGORIES,
  UPLOADS: {
    maxBytes: config.UPLOADS.maxBytes,
    maxImagesPerVendor: config.UPLOADS.maxImagesPerVendor,
    allowedMimes: Object.keys(config.UPLOADS.allowed),
    rightsStatement: config.UPLOADS.rightsStatement,
  },
  VERIFICATION_SCOPE: config.VERIFICATION_SCOPE,
  FAIR_USE: config.FAIR_USE,
})};
window.AETERNA_IMAGES = ${JSON.stringify({
  hero: images.hero, couples: images.couples,
  categoryTiles: images.categoryTiles, portfolio: images.portfolio, headshots: images.headshots,
})};
window.AETERNA_SEED_VENDORS = ${JSON.stringify(SAMPLE_VENDORS)};
window.AETERNA_CHECKLIST = ${JSON.stringify(CHECKLIST_TEMPLATE)};
window.AETERNA_TIMELINE = ${JSON.stringify(TIMELINE_TEMPLATE)};
window.__AETERNA_SCOPE__ = {};
`;

const banner = `
<!--
  AETERNA, standalone demo build.
  Generated from the full application source by scripts/build-static.js.
  API calls are served by an in browser port of the server logic, so routing,
  pricing, fair use limits and the published policies behave as they do live.
  No payment processing and no live AI model are connected in this file.
-->`;

let output = html
  .replace('<link rel="stylesheet" href="/css/aeterna.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="/js/app.js"></script>',
    `<script>\n${fixtures}\n</script>\n<script>\n${demoBackend}\n</script>\n<script>\n(function(){\n'use strict';\n${bundle}\n})();\n</script>`
  )
  .replace('<!DOCTYPE html>', `<!DOCTYPE html>${banner}`);

// The demo build has no server, so add an honest banner inside the page too.
output = output.replace('<main id="main" tabindex="-1">', `<div style="background:#2B2118;color:#F4D9DC;padding:10px 20px;text-align:center;font:600 13px/1.5 'Plus Jakarta Sans',sans-serif">
  Standalone demo build. Accounts, enquiries and the planner all work in your browser, and nothing is charged or sent anywhere.
</div>
<main id="main" tabindex="-1">`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, output);

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
process.stdout.write(`Built ${path.relative(ROOT, OUT)}, ${kb} KB\n`);
