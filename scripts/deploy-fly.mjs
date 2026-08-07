#!/usr/bin/env node
/**
 * Deploy AETERNA to Fly.io using only HTTPS APIs. No flyctl, no Docker daemon.
 *
 * How it works: instead of building an image, a stock node:22-alpine machine
 * fetches the source tarball from GitHub at boot, extracts it and runs the
 * server. State lives on a Fly volume mounted at /data. Idempotent: safe to
 * re-run, and re-running after a push restarts the machine on fresh source.
 *
 * Required environment:
 *   FLY_API_TOKEN   a Fly.io API token (fly tokens create deploy, or dashboard)
 * Optional:
 *   FLY_APP         app name        (default aeterna-app)
 *   FLY_REGION      region          (default lhr)
 *   FLY_ORG         org slug        (default personal)
 *   SOURCE_TARBALL  source .tar.gz  (default the GitHub main branch of ssbenson110/Aeterna)
 *   APP_SECRET      AETERNA_SECRET value (default: generated and printed once)
 *
 * The GitHub repo must be reachable from the machine at boot. A public repo
 * works as-is. If the repo goes private, pass SOURCE_TARBALL with a tokened URL.
 */

import crypto from 'node:crypto';

const TOKEN = process.env.FLY_API_TOKEN;
if (!TOKEN) {
  console.error('FLY_API_TOKEN is not set. Create one at https://fly.io/user/personal_access_tokens or with: fly tokens create deploy');
  process.exit(1);
}

const APP = process.env.FLY_APP || 'aeterna-app';
const REGION = process.env.FLY_REGION || 'lhr';
const ORG = process.env.FLY_ORG || 'personal';
const TARBALL = process.env.SOURCE_TARBALL
  || 'https://codeload.github.com/ssbenson110/Aeterna/tar.gz/refs/heads/main';

const MACHINES = 'https://api.machines.dev/v1';
const GRAPHQL = 'https://api.fly.io/graphql';

async function machines(method, path, body) {
  const res = await fetch(`${MACHINES}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

async function graphql(query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.errors && data.errors.length) throw new Error(`GraphQL: ${data.errors[0].message}`);
  return data.data;
}

function fail(step, detail) {
  console.error(`\nFAILED at ${step}`);
  console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
}

const log = (msg) => console.log(`  ${msg}`);

/* 1. App */
console.log(`Deploying ${APP} to ${REGION} (org ${ORG})`);
{
  const existing = await machines('GET', `/apps/${APP}`);
  if (existing.status === 404) {
    const created = await machines('POST', '/apps', { app_name: APP, org_slug: ORG });
    if (!created.ok) fail('app create', created.data);
    log(`app created: ${APP}`);
  } else if (existing.ok) {
    log(`app exists: ${APP}`);
  } else fail('app lookup', existing.data);
}

/* 2. Shared IPs so the .fly.dev hostname routes */
{
  const data = await graphql(
    `query($name: String!) { app(name: $name) { id ipAddresses { nodes { type address } } } }`,
    { name: APP }
  );
  const have = new Set((data.app.ipAddresses.nodes || []).map((n) => String(n.type).toLowerCase()));
  const want = [['shared_v4', 'v4'], ['v6', 'v6']];
  for (const [allocType, label] of want) {
    const already = label === 'v4' ? [...have].some((t) => t.includes('v4')) : have.has('v6');
    if (already) { log(`ip ${label} already allocated`); continue; }
    await graphql(
      `mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { ipAddress { address } } }`,
      { input: { appId: APP, type: allocType } }
    ).then(() => log(`ip ${label} allocated`))
     .catch((e) => { if (!/already/i.test(e.message)) throw e; log(`ip ${label} already allocated`); });
  }
}

/* 3. Secrets: session key and origin, set before the machine boots */
{
  const secret = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
  const origin = `https://${APP}.fly.dev`;
  await graphql(
    `mutation($input: SetSecretsInput!) { setSecrets(input: $input) { release { id } } }`,
    { input: { appId: APP, secrets: [
      { key: 'AETERNA_SECRET', value: secret },
      { key: 'APP_ORIGIN', value: origin },
    ] } }
  );
  log(`secrets set: AETERNA_SECRET, APP_ORIGIN=${origin}`);
  if (!process.env.APP_SECRET) log('(AETERNA_SECRET was generated fresh; existing sessions sign out on redeploy unless you pass APP_SECRET)');
}

/* 4. Volume */
let volumeId = null;
{
  const vols = await machines('GET', `/apps/${APP}/volumes`);
  if (!vols.ok) fail('volume list', vols.data);
  const existing = (vols.data || []).find((v) => v.name === 'aeterna_data' && v.region === REGION);
  if (existing) { volumeId = existing.id; log(`volume exists: ${volumeId}`); }
  else {
    const created = await machines('POST', `/apps/${APP}/volumes`, {
      name: 'aeterna_data', region: REGION, size_gb: 1,
    });
    if (!created.ok) fail('volume create', created.data);
    volumeId = created.data.id;
    log(`volume created: ${volumeId}`);
  }
}

/* 5. Machine: stock node image, fetch source at boot, run */
const bootCmd = [
  'sh', '-c',
  `wget -qO /tmp/src.tar.gz "${TARBALL}" && mkdir -p /app && ` +
  'tar -xzf /tmp/src.tar.gz -C /app --strip-components=1 && ' +
  'exec node /app/server/index.js',
];

const machineConfig = {
  region: REGION,
  config: {
    image: 'node:22-alpine',
    guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 512 },
    env: { PORT: '8080', AETERNA_DATA_DIR: '/data', NODE_ENV: 'production' },
    init: { cmd: bootCmd },
    mounts: [{ volume: volumeId, path: '/data' }],
    services: [{
      protocol: 'tcp',
      internal_port: 8080,
      ports: [
        { port: 80, handlers: ['http'], force_https: true },
        { port: 443, handlers: ['tls', 'http'] },
      ],
      checks: [{ type: 'http', port: 8080, method: 'GET', path: '/api/health', interval: '30s', timeout: '5s', grace_period: '15s' }],
    }],
    restart: { policy: 'always' },
  },
};

{
  const list = await machines('GET', `/apps/${APP}/machines`);
  if (!list.ok) fail('machine list', list.data);
  const existing = (list.data || []).find((m) => m.state !== 'destroyed');
  if (existing) {
    const updated = await machines('POST', `/apps/${APP}/machines/${existing.id}`, machineConfig);
    if (!updated.ok) fail('machine update', updated.data);
    log(`machine updated: ${existing.id} (rebooting on fresh source)`);
  } else {
    const created = await machines('POST', `/apps/${APP}/machines`, machineConfig);
    if (!created.ok) fail('machine create', created.data);
    log(`machine created: ${created.data.id}`);
  }
}

/* 6. Wait for health */
{
  const url = `https://${APP}.fly.dev/api/health`;
  log(`waiting for ${url}`);
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const health = await res.json();
        console.log(`\nDeployed. ${url} answers:`);
        console.log(JSON.stringify(health, null, 2));
        console.log(`\nNext: create the first admin account:`);
        console.log(`  fly ssh console -a ${APP} -C "node -e \\"const{run,id,now}=require('/app/server/db');const{hashPassword}=require('/app/server/lib/auth');run('INSERT INTO users (id,email,password_hash,role,display_name,created_at) VALUES (?,?,?,?,?,?)',id('usr'),'you@example.com',hashPassword(process.env.PW),'admin','AETERNA team',now())\\""`);
        process.exit(0);
      }
    } catch { /* not up yet */ }
  }
  fail('health wait', `The machine did not answer on ${url} within 150 seconds. Check: fly logs -a ${APP}`);
}
