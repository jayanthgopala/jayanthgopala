/**
 * Generates wrangler.toml from wrangler.example.toml.
 *
 * Why this exists: Workers Builds needs a wrangler.toml in the repo to know the
 * entrypoint and bindings, but that file carries account-scoped D1/KV ids. Rather
 * than tracking it — which makes the config a place a real secret eventually gets
 * added by mistake — the template is tracked with placeholders and the ids come
 * from build-time environment variables.
 *
 * Local development is untouched: if wrangler.toml already exists, this exits
 * without writing anything.
 *
 * Set these as Build variables in Workers Builds:
 *   D1_DATABASE_ID    KV_NAMESPACE_ID
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(here, '..', 'wrangler.toml');
const TEMPLATE = join(here, '..', 'wrangler.example.toml');

// Local machines already have a real config — never clobber it.
if (existsSync(CONFIG)) {
  console.log('wrangler.toml present — leaving it alone (local development).');
  process.exit(0);
}

const REPLACEMENTS = {
  __D1_DATABASE_ID__: 'D1_DATABASE_ID',
  __KV_NAMESPACE_ID__: 'KV_NAMESPACE_ID',
};

if (!existsSync(TEMPLATE)) {
  console.error(`Missing ${TEMPLATE}. Cannot generate wrangler.toml.`);
  process.exit(1);
}

let config = readFileSync(TEMPLATE, 'utf8');
const missing = [];

for (const [placeholder, envName] of Object.entries(REPLACEMENTS)) {
  const value = process.env[envName];
  if (!value) {
    missing.push(envName);
    continue;
  }
  config = config.replaceAll(placeholder, value);
}

if (missing.length) {
  console.error(
    [
      '',
      'Cannot generate wrangler.toml — missing build variables:',
      ...missing.map((n) => `  ${n}`),
      '',
      'In Cloudflare: Workers > portfolio-api > Settings > Build >',
      'Variables and secrets > add them as plaintext Build variables.',
      'Find the values with:  npx wrangler d1 list   and   npx wrangler kv namespace list',
      '',
    ].join('\n')
  );
  process.exit(1);
}

// A leftover placeholder would deploy a Worker with a broken binding, which
// fails at request time rather than deploy time — catch it here instead.
const leftover = config.match(/__[A-Z0-9_]+__/g);
if (leftover) {
  console.error(`Unsubstituted placeholders remain: ${[...new Set(leftover)].join(', ')}`);
  process.exit(1);
}

writeFileSync(CONFIG, config);
console.log('Generated wrangler.toml from template with build variables.');
