# Agent notes

## ⚠️ THIS IS A PUBLIC REPOSITORY

`github.com/jayanthgopala/jayanthgopala` is **public** — it is the GitHub profile
repo, so its README renders on the owner's profile page. Everything committed here
is visible to everyone, permanently, including in git history after deletion.

**Never commit a secret.** Not in a config file, not in a comment, not in a test
fixture, not "temporarily".

### Secrets live in the Cloudflare Worker secret store, never in files

There are exactly three, and they are set interactively:

```bash
cd apps/api
npx wrangler secret put ADMIN_PASSWORD   # admin panel login
npx wrangler secret put JWT_SECRET       # session signing key
npx wrangler secret put GITHUB_TOKEN     # fine-grained PAT, Contents:RW, this repo only
```

They are read at runtime as `env.ADMIN_PASSWORD` etc. If you need a new secret,
add it the same way. **Do not** put it in `[vars]` in `wrangler.toml` — that block
is plaintext config, not secrets, and the distinction is invisible until it leaks.

### Files that are git-ignored on purpose — leave them ignored

| File | Why |
|---|---|
| `apps/api/.dev.vars` | local copies of the three secrets |
| `apps/api/wrangler.toml` | carries account-scoped D1/KV resource ids |

`apps/api/wrangler.example.toml` is the tracked template with placeholders. Copy it
to `wrangler.toml` and fill in real ids locally.

> The ids themselves are not credentials and publishing them would not be a
> vulnerability. They are ignored because a tracked config file is where a real
> secret eventually gets added by mistake. Un-ignoring it is only needed for
> Cloudflare Workers Builds, which this project deliberately does not use — the
> Worker is deployed manually with `npx wrangler deploy`.

### Before committing

```bash
git diff --cached | grep -iE "ghp_|github_pat_|password *=|secret *=|api[_-]?key"
```

Anything that matches and isn't an obvious placeholder should not be committed.

---

## Project shape

One admin panel drives three surfaces: the website, the GitHub profile README, and
live SVG cards embedded in that README.

```
apps/api      Cloudflare Worker — Hono, D1, KV, R2, GitHub Contents sync
apps/web      Public site, React 19 + Vite (Pages: jayanthgopala.com)
apps/admin    Admin panel, React 19 + Vite (Pages: admin.jayanthgopala.com)
packages/     Shared design tokens
```

- Full architecture: `docs/ARCHITECTURE.md`
- Deployment: `docs/DEPLOYMENT.md`
- Token scoping: `docs/GITHUB-TOKEN.md`

### Things that have bitten before

**Scheme-less URLs.** A URL without `https://` is treated as *relative* by browsers
and by GitHub-rendered Markdown, so it silently resolves against the current origin
and lands back on the same site. This caused three separate bugs (API base, project
"Live Demo" links, README links). `externalUrl()` in `apps/web/src/lib/api.js` and
`href()` in `apps/api/src/lib/readme.js` normalise it — route new user-entered URLs
through them.

**`README.md` is generated.** The sync engine overwrites it from the database on
every publish and via cron. Hand edits do not survive. Architecture docs live in
`docs/ARCHITECTURE.md` for that reason.

**Seed data is fiction.** `schema.sql` ships demo projects and guessed skill levels
so the site renders during development. It is not the owner's real work — never let
it reach the public profile.

**Pages env vars are build-time.** `VITE_*` variables are inlined at build; setting
one without redeploying changes nothing. Both frontends default to the production
Worker URL in code so a missing variable can't break them.
