#!/usr/bin/env node
// Cloudflare provisioning and deployment script

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps', 'api');
const TEMPLATE = join(API, 'wrangler.example.toml');
const CONFIG = join(API, 'wrangler.toml');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

let step = 0;
const heading = (msg) => console.log(`\n${c.bold(`${++step}. ${msg}`)}`);
const ok = (msg) => console.log(`   ${c.green('ok')} ${msg}`);
const info = (msg) => console.log(`   ${c.dim(msg)}`);
const warn = (msg) => console.log(`   ${c.yellow('warn')} ${msg}`);

function die(msg) {
  console.error(`\n${c.red('error')} ${msg}\n`);
  process.exit(1);
}

// Parses JSON from mixed stdout/stderr output
function jsonFrom(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

// Setup steps

// Runs `npx wrangler ...` from apps/api, so it picks up wrangler.toml there.
// Returns { status, out } with stdout and stderr merged.
function wrangler(args, { capture = true, stdin } = {}) {
  const res = spawnSync('npx', ['--yes', 'wrangler', ...args], {
    cwd: API,
    encoding: 'utf8',
    input: stdin,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return { status: res.status ?? 1, out: `${res.stdout || ''}${res.stderr || ''}` };
}

// Provisioning. Each helper reuses a resource of the same name if one exists,
// so the script can be re-run without creating duplicates.

function ensureD1(name) {
  const list = wrangler(['d1', 'list', '--json']);
  const found = (jsonFrom(list.out) || []).find((d) => d.name === name);
  if (found) {
    ok(`D1 database "${name}" exists.`);
    return found.uuid;
  }
  const res = wrangler(['d1', 'create', name]);
  const id = res.out.match(/database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/i)?.[1];
  if (res.status !== 0 || !id) die(`Could not create the D1 database.\n${res.out}`);
  ok(`D1 database "${name}" created.`);
  return id;
}

function ensureKV(title) {
  const list = wrangler(['kv', 'namespace', 'list']);
  const found = (jsonFrom(list.out) || []).find((n) => n.title === title || n.title.endsWith(`-${title}`));
  if (found) {
    ok(`KV namespace "${title}" exists.`);
    return found.id;
  }
  const res = wrangler(['kv', 'namespace', 'create', title]);
  const id = res.out.match(/"?id"?\s*[=:]\s*"([0-9a-f]{32})"/i)?.[1];
  if (res.status !== 0 || !id) die(`Could not create the KV namespace.\n${res.out}`);
  ok(`KV namespace "${title}" created.`);
  return id;
}

function ensureR2(bucket) {
  const list = wrangler(['r2', 'bucket', 'list']);
  if (new RegExp(`^name:\s+${bucket}\s*$`, 'm').test(list.out)) {
    ok(`R2 bucket "${bucket}" exists.`);
    return;
  }
  const res = wrangler(['r2', 'bucket', 'create', bucket]);
  if (res.status !== 0) die(`Could not create the R2 bucket.\n${res.out}`);
  ok(`R2 bucket "${bucket}" created.`);
}

async function ensureLogin() {
  heading('Cloudflare account');

  if (process.env.CLOUDFLARE_API_TOKEN) {
    ok('Using CLOUDFLARE_API_TOKEN from the environment.');
    return;
  }

  const who = wrangler(['whoami']);
  if (who.status === 0 && /associated with the email|Account ID/i.test(who.out)) {
    const email = who.out.match(/associated with the email\s+([^\s.]+@[^\s.]+\.\S+?)[.\s]/i);
    ok(`Already logged in${email ? ` as ${email[1]}` : ''}.`);
    return;
  }

  info('Opening a browser to authorise wrangler...');
  info('No browser? Ctrl-C, then export CLOUDFLARE_API_TOKEN and re-run.');
  // Inherit stdio: this is an interactive OAuth flow, not something to capture.
  const login = wrangler(['login'], { capture: false });
  if (login.status !== 0) die('wrangler login failed or was cancelled.');
  ok('Logged in.');
}

async function collect(rl) {
  heading('Your details');
  info('These go into wrangler.toml. Nothing here is secret.');

  const githubUser = (await rl.question('   GitHub username: ')).trim();
  if (!githubUser) die('A GitHub username is required.');

  const githubRepo =
    (await rl.question(`   Profile repo [${githubUser}]: `)).trim() || githubUser;
  const workerName =
    (await rl.question('   Worker name [portfolio-api]: ')).trim() || 'portfolio-api';
  const dbName = (await rl.question('   D1 database [portfolio]: ')).trim() || 'portfolio';
  const bucket =
    (await rl.question('   R2 bucket [portfolio-media]: ')).trim() || 'portfolio-media';

  return { githubUser, githubRepo, workerName, dbName, bucket };
}

// Reads a key-value pair from existing config
function existingVar(key) {
  if (!existsSync(CONFIG)) return null;
  const m = readFileSync(CONFIG, 'utf8').match(new RegExp(`^${key} *= *"([^"]*)"`, 'm'));
  return m && m[1] ? m[1] : null;
}

function writeConfig({ workerName, dbName, bucket, githubUser, githubRepo, d1Id, kvId }) {
  if (!existsSync(TEMPLATE)) die(`Missing ${TEMPLATE}.`);

  // Preserve existing origins and public URL across re-runs
  const keepOrigins = existingVar('ALLOWED_ORIGINS');
  const keepPublicUrl = existingVar('PUBLIC_API_URL');

  if (existsSync(CONFIG)) {
    writeFileSync(`${CONFIG}.bak`, readFileSync(CONFIG, 'utf8'), 'utf8');
    info('Existing wrangler.toml backed up to wrangler.toml.bak');
  }

  let toml = readFileSync(TEMPLATE, 'utf8');

  toml = toml
    .replace('__D1_DATABASE_ID__', d1Id)
    .replace('__KV_NAMESPACE_ID__', kvId)
    .replace(/^name = ".*"$/m, `name = "${workerName}"`)
    .replace(/^database_name = ".*"$/m, `database_name = "${dbName}"`)
    .replace(/^bucket_name = ".*"$/m, `bucket_name = "${bucket}"`)
    .replace(/^GITHUB_USER( *)= ".*"$/m, `GITHUB_USER$1= "${githubUser}"`)
    .replace(/^GITHUB_REPO( *)= ".*"(.*)$/m, `GITHUB_REPO$1= "${githubRepo}"$2`)
    // Only knowable after the first deploy; preserved once it is.
    .replace(/^PUBLIC_API_URL( *)= ".*"$/m, `PUBLIC_API_URL$1= "${keepPublicUrl || ''}"`)
    // Localhost only until Pages exists — see --origins. Never narrowed on a re-run.
    .replace(
      /^ALLOWED_ORIGINS( *)= ".*"$/m,
      `ALLOWED_ORIGINS$1= "${
        keepOrigins ||
        'http://localhost:5173,http://localhost:5174,http://localhost:4173,http://localhost:4180'
      }"`
    );

  writeFileSync(CONFIG, toml, 'utf8');
  ok(`Wrote ${CONFIG.replace(ROOT, '.')}`);
}

function applySchema(dbName) {
  // apps/api/migrations/0001_init.sql is the full schema and starter content.
  // wrangler records what it has applied, so re-running is a no-op, and a
  // database that already has the tables is left untouched.
  const res = wrangler(['d1', 'migrations', 'apply', dbName, '--remote'], { stdin: 'y\n' });
  if (res.status !== 0) die(`Applying migrations failed.\n${res.out}`);
  ok('Database migrated.');
}

async function setSecrets(rl) {
  heading('Secrets');
  info('Stored in Cloudflare, never written to disk or the repo.');

  const password = (await rl.question('   Admin panel password: ')).trim();
  if (password.length < 8) die('Use at least 8 characters.');

  // Generated rather than asked for: this only ever needs to be long and random,
  // and a human-chosen value here would be the weakest part of the auth chain.
  const jwt = randomBytes(32).toString('hex');

  for (const [key, value] of [['ADMIN_PASSWORD', password], ['JWT_SECRET', jwt]]) {
    const r = wrangler(['secret', 'put', key], { stdin: `${value}\n` });
    if (r.status !== 0) die(`Could not set ${key}.\n${r.out}`);
    ok(`${key} set.`);
  }

  console.log('');
  info('GitHub token — only needed to auto-publish your profile README.');
  info('Fine-grained PAT, your profile repo only, Contents: read and write.');
  const token = (await rl.question('   GitHub token (blank to skip): ')).trim();
  if (!token) {
    warn('Skipped. The site works; profile sync stays off until you set it:');
    info('  npx wrangler secret put GITHUB_TOKEN   (from apps/api)');
    return;
  }
  const r = wrangler(['secret', 'put', 'GITHUB_TOKEN'], { stdin: `${token}\n` });
  if (r.status !== 0) die(`Could not set GITHUB_TOKEN.\n${r.out}`);
  ok('GITHUB_TOKEN set.');
}

function deploy() {
  heading('Deploying the backend');
  const res = wrangler(['deploy']);
  if (res.status !== 0) die(`Deploy failed.\n${res.out}`);

  const url = res.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
  if (!url) {
    warn('Deployed, but could not read the URL from the output.');
    return null;
  }
  ok(`Live at ${c.cyan(url)}`);
  return url;
}

// Update PUBLIC_API_URL and redeploy worker
function backfillPublicUrl(url) {
  if (!url || !existsSync(CONFIG)) return;
  const toml = readFileSync(CONFIG, 'utf8').replace(
    /^PUBLIC_API_URL( *)= ".*"$/m,
    `PUBLIC_API_URL$1= "${url}"`
  );
  writeFileSync(CONFIG, toml, 'utf8');
  const res = wrangler(['deploy']);
  if (res.status === 0) ok('PUBLIC_API_URL written back.');
  else warn('Could not redeploy with PUBLIC_API_URL — set it in wrangler.toml and deploy again.');
}

/** Local builds need the URL too; Pages gets it from the dashboard. */
function writeEnvFiles(url) {
  if (!url) return;
  for (const app of ['web', 'admin']) {
    const file = join(ROOT, 'apps', app, '.env');
    writeFileSync(file, `VITE_API_URL=${url}\n`, 'utf8');
    ok(`apps/${app}/.env`);
  }
  info('Git-ignored — these are for local builds only.');
}

function nextSteps(url, { workerName }) {
  const api = url || `https://${workerName}.<your-subdomain>.workers.dev`;
  console.log(`
${c.bold('Backend is live. Two things left, both in the dashboard.')}

${c.bold('1. Create two Pages projects')} — Workers & Pages → Create → Pages → Connect to Git.
   Point both at this repository.

   ${c.bold('Public site')}                     ${c.bold('Admin panel')}
     Root directory  apps/web           Root directory  apps/admin
     Build command   npm run build      Build command   npm run build
     Output          dist               Output          dist

   Environment variables
     site:   VITE_API_URL = ${api}
             API_URL      = ${api}
     admin:  VITE_API_URL = ${api}

   ${c.yellow('Include the scheme.')} Without https:// the browser treats it as a relative
   path, every API call returns index.html, and the site dies with
   "Unexpected token '<'".

   Settings → Builds → Watch paths
     site:  apps/web/*      admin:  apps/admin/*
   Without these, every profile-README sync rebuilds both projects and the
   admin panel 403s for several minutes each time.

${c.bold('2. Then run:')}  ${c.cyan('npm run setup -- --origins')}
   Adds your Pages URLs to ALLOWED_ORIGINS. Until then the admin panel logs in
   and every request fails, because credentialed CORS cannot use a wildcard.

${c.dim('Everything that cannot be scripted is in docs/MANUAL-STEPS.md.')}
`);
}

// Allowed origins configuration

async function updateOrigins(rl) {
  if (!existsSync(CONFIG)) die('No wrangler.toml — run `npm run setup` first.');

  console.log(c.bold('\nAllowed origins\n'));
  info('Every domain the site or admin panel is served from.');
  info('Comma-separated, with scheme. Example:');
  info('  https://you.com,https://www.you.com,https://you.pages.dev');

  const answer = (await rl.question('\n   Origins: ')).trim();
  if (!answer) die('Nothing entered.');

  const local = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173', 'http://localhost:4180'];
  const origins = [...new Set([...answer.split(',').map((s) => s.trim()).filter(Boolean), ...local])];

  const bad = origins.filter((o) => !/^https?:\/\//i.test(o));
  if (bad.length) die(`These need a scheme: ${bad.join(', ')}`);

  const toml = readFileSync(CONFIG, 'utf8').replace(
    /^ALLOWED_ORIGINS( *)= ".*"$/m,
    `ALLOWED_ORIGINS$1= "${origins.join(',')}"`
  );
  writeFileSync(CONFIG, toml, 'utf8');
  ok(`${origins.length} origins written.`);

  const res = wrangler(['deploy']);
  if (res.status !== 0) die(`Redeploy failed.\n${res.out}`);
  ok('Redeployed. The admin panel should work now.');
}

// CLI entry point

const rl = createInterface({ input, output });

try {
  if (process.argv.includes('--origins')) {
    await ensureLogin();
    await updateOrigins(rl);
  } else {
    console.log(c.bold('\nPortfolio setup\n'));
    console.log(c.dim('Provisions D1, KV and R2 on your Cloudflare account, then'));
    console.log(c.dim('deploys the backend. Safe to re-run.\n'));

    await ensureLogin();
    const answers = await collect(rl);

    heading('Provisioning');
    const d1Id = ensureD1(answers.dbName);
    const kvId = ensureKV(`${answers.workerName}-cache`);
    ensureR2(answers.bucket);
    writeConfig({ ...answers, d1Id, kvId });

    heading('Database');
    applySchema(answers.dbName);

    await setSecrets(rl);

    const url = deploy();
    backfillPublicUrl(url);

    heading('Local environment');
    writeEnvFiles(url);

    nextSteps(url, answers);
  }
} finally {
  rl.close();
}
