#!/usr/bin/env node
/**
 * One-command Cloudflare setup.
 *
 *     npm run setup            provision everything and deploy the backend
 *     npm run setup -- --origins   update ALLOWED_ORIGINS once Pages is live
 *
 * What this does NOT do — and why — is documented in docs/MANUAL-STEPS.md.
 * The short version: creating the two Pages projects is dashboard-only, because
 * `wrangler pages deploy` is a *direct upload* that produces a project with no
 * Git connection, and therefore no deploy-on-push and no build watch paths.
 *
 * Every step is safe to re-run. Resources that already exist are reused rather
 * than recreated, so a failed run halfway through is fixed by running it again.
 */

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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
const ok = (msg) => console.log(`   ${c.green('✓')} ${msg}`);
const info = (msg) => console.log(`   ${c.dim(msg)}`);
const warn = (msg) => console.log(`   ${c.yellow('!')} ${msg}`);

function die(msg) {
  console.error(`\n${c.red('✗')} ${msg}\n`);
  process.exit(1);
}

/** Runs wrangler and returns { status, stdout }. Never throws. */
function wrangler(args, { cwd = API, capture = true, stdin } = {}) {
  const res = spawnSync('npx', ['wrangler', ...args], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    input: stdin,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  return { status: res.status, out };
}

/**
 * Wrangler writes progress to stderr and data to stdout, and mixes both when a
 * command half-fails. Anything parsing output has to look at the combined text.
 */
function jsonFrom(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

// --- Steps -----------------------------------------------------------------

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

  info('Opening a browser to authorise wrangler…');
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

/** Creates the database if absent; returns its uuid either way. */
function ensureD1(name) {
  const list = jsonFrom(wrangler(['d1', 'list', '--json']).out);
  const found = Array.isArray(list) && list.find((d) => d.name === name);
  if (found) {
    ok(`D1 "${name}" already exists.`);
    return found.uuid || found.id;
  }

  const created = wrangler(['d1', 'create', name]);
  if (created.status !== 0) die(`Could not create D1 "${name}".\n${created.out}`);

  // The id is echoed in a TOML snippet; re-listing is more reliable than
  // parsing prose that changes between wrangler releases.
  const after = jsonFrom(wrangler(['d1', 'list', '--json']).out);
  const row = Array.isArray(after) && after.find((d) => d.name === name);
  const id = row && (row.uuid || row.id);
  if (!id) die(`Created D1 "${name}" but could not read its id back.`);
  ok(`D1 "${name}" created.`);
  return id;
}

function ensureKV(title) {
  const list = jsonFrom(wrangler(['kv', 'namespace', 'list']).out);
  const found = Array.isArray(list) && list.find((n) => n.title === title);
  if (found) {
    ok(`KV "${title}" already exists.`);
    return found.id;
  }

  const created = wrangler(['kv', 'namespace', 'create', title]);
  if (created.status !== 0) die(`Could not create KV "${title}".\n${created.out}`);

  const after = jsonFrom(wrangler(['kv', 'namespace', 'list']).out);
  const row = Array.isArray(after) && after.find((n) => n.title === title);
  const id = row?.id || created.out.match(/id\s*=\s*"([0-9a-f]{32})"/i)?.[1];
  if (!id) die(`Created KV "${title}" but could not read its id back.`);
  ok(`KV "${title}" created.`);
  return id;
}

function ensureR2(name) {
  const created = wrangler(['r2', 'bucket', 'create', name]);
  // Already existing is success for our purposes, not an error.
  if (created.status === 0) ok(`R2 bucket "${name}" created.`);
  else if (/already (exists|owned)/i.test(created.out)) ok(`R2 bucket "${name}" already exists.`);
  else die(`Could not create R2 bucket "${name}".\n${created.out}`);
}

/**
 * Reads one `KEY = "value"` out of an existing config, if there is one.
 *
 * Deliberately not anchored to end-of-line: several entries in the template
 * carry a trailing comment, and an anchored match would silently return null
 * for them — which, for ALLOWED_ORIGINS, would mean resetting a working site's
 * CORS to localhost on a re-run.
 */
function existingVar(key) {
  if (!existsSync(CONFIG)) return null;
  const m = readFileSync(CONFIG, 'utf8').match(new RegExp(`^${key} *= *"([^"]*)"`, 'm'));
  return m && m[1] ? m[1] : null;
}

function writeConfig({ workerName, dbName, bucket, githubUser, githubRepo, d1Id, kvId }) {
  if (!existsSync(TEMPLATE)) die(`Missing ${TEMPLATE}.`);

  /*
   * Re-running must not undo the two values that are only knowable after the
   * first pass. Regenerating them blindly would reset ALLOWED_ORIGINS to
   * localhost and then redeploy — taking a working site's admin panel down with
   * a CORS error, on a command whose whole promise is that it is safe to repeat.
   */
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
  const schema = join(API, 'schema.sql');
  if (!existsSync(schema)) die(`Missing ${schema}.`);

  const res = wrangler(['d1', 'execute', dbName, '--remote', '--yes', '--file', schema]);
  if (res.status !== 0) {
    // A second run hits "table already exists", which is expected and harmless.
    if (/already exists/i.test(res.out)) ok('Schema already applied.');
    else die(`Applying schema.sql failed.\n${res.out}`);
  } else {
    ok('Schema applied.');
  }

  const dir = join(API, 'migrations');
  if (!existsSync(dir)) return;

  // Lexical order is the intended order — the files are numbered.
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const r = wrangler(['d1', 'execute', dbName, '--remote', '--yes', '--file', join(dir, file)]);
    if (r.status === 0) ok(`Migration ${file}`);
    else if (/duplicate column|already exists/i.test(r.out)) info(`Migration ${file} (already applied)`);
    else die(`Migration ${file} failed.\n${r.out}`);
  }
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

/**
 * PUBLIC_API_URL is what the profile README points its live SVG cards at, so it
 * is only knowable after the first deploy. Write it back and redeploy once.
 */
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

// --- Origins pass ----------------------------------------------------------

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

// --- Entry -----------------------------------------------------------------

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
