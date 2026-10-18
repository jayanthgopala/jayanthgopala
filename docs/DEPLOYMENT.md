# Deployment

This project is three deployable pieces on Cloudflare's free tier:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| API | Hono app: content, auth, uploads, `/api/ask`, profile README sync | Cloudflare Worker (`apps/api`) |
| Website | React + Vite site with the 3D world | Cloudflare Pages (`apps/web`) |
| Admin panel | React + Vite editor for all content | Cloudflare Pages (`apps/admin`) |

The API stores data in D1 (SQLite), caches in KV, keeps uploads in R2 and uses
Workers AI for the "Ask about me" assistant.

There are two ways to deploy. Use the guided script if you want the quickest
path, or follow the manual steps if you prefer to run each command yourself.

---

## Prerequisites

- A free Cloudflare account.
- Node.js 20 or newer, and npm.
- Git, and a GitHub account (only needed for the optional profile README sync
  and for Git-connected Pages deploys).

Get the code and install dependencies:

```bash
git clone https://github.com/<you>/<your-fork>.git
cd <your-fork>
npm install
```

Use `npm install`, not `npm ci`, on a first run only if you have changed
`package.json`. If you add or rename a workspace package, run `npm install` and
commit the updated `package-lock.json`; `npm ci` (which Cloudflare runs) fails
when the lockfile is out of sync.

---

## Option A: guided setup (recommended)

```bash
npm run setup
```

The script is safe to re-run. It will:

1. Log in to Cloudflare (or use `CLOUDFLARE_API_TOKEN` if you export one).
2. Ask for your GitHub username, worker name, database name and bucket name.
3. Create the D1 database, KV namespace and R2 bucket, or reuse ones with the
   same names.
4. Write `apps/api/wrangler.toml` from `wrangler.example.toml` with the real ids.
5. Run the database migration (`apps/api/migrations/0001_init.sql`).
6. Store `ADMIN_PASSWORD` and a generated `JWT_SECRET` as Worker secrets, and
   optionally `GITHUB_TOKEN`.
7. Deploy the API and write its URL back into `PUBLIC_API_URL`.
8. Write `apps/web/.env` and `apps/admin/.env` for local builds.

It then prints the two things that cannot be scripted: creating the Pages
projects, and adding their URLs to the API's allowed origins. Both are covered
in steps 6 and 7 below, and in `docs/MANUAL-STEPS.md`.

If you have more than one Cloudflare account, export the one to use first:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account id>
```

---

## Option B: manual deployment

Every step below is what the guided script does, written out.

### 1. Log in to Cloudflare

```bash
cd apps/api
npx wrangler login
npx wrangler whoami
```

`whoami` must show the account you want to deploy to. If it shows a different
account, run `npx wrangler logout` and log in again, or export
`CLOUDFLARE_ACCOUNT_ID`.

On a machine without a browser, create an API token with the Workers, D1, KV and
R2 edit permissions and export it instead:

```bash
export CLOUDFLARE_API_TOKEN=<token>
```

### 2. Create the resources

```bash
npx wrangler d1 create portfolio
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create portfolio-media
```

The first two commands print an id each. Keep them for the next step.

### 3. Create `wrangler.toml`

```bash
cp wrangler.example.toml wrangler.toml
```

Edit `apps/api/wrangler.toml` (this file is git-ignored):

- Replace `__D1_DATABASE_ID__` with the D1 id and `__KV_NAMESPACE_ID__` with the
  KV id.
- Set `GITHUB_USER` and `GITHUB_REPO` to your GitHub handle. The profile repo is
  named after you, so both are normally the same value.
- Leave `PUBLIC_API_URL` and `ALLOWED_ORIGINS` for now; steps 5 and 7 fill them.

### 4. Run the database migration

```bash
npm run db:migrate          # from apps/api, applies to the remote database
npm run db:local            # optional: the same migration against the local dev database
```

This applies `apps/api/migrations/0001_init.sql`, which creates every table and
the starter content. Wrangler records what it has applied, so running it again
does nothing, and it never overwrites content you have edited.

Later schema changes are added as new numbered files in `apps/api/migrations/`
(for example `0002_add_something.sql`) and applied with the same command.

### 5. Set secrets and deploy the API

```bash
npx wrangler secret put ADMIN_PASSWORD   # the password for the admin panel
npx wrangler secret put JWT_SECRET       # 32 or more random characters
npx wrangler secret put GITHUB_TOKEN     # optional, see docs/GITHUB-TOKEN.md

npx wrangler deploy
```

Generate a random secret with `openssl rand -base64 32`.

Wrangler prints the API URL (`https://<worker>.<subdomain>.workers.dev`). Put it
in `PUBLIC_API_URL` in `wrangler.toml` and deploy again. The README's live image
cards point at that value.

Check it:

```bash
curl https://<api-url>/api/public/site
```

### 6. Deploy the website and admin panel

Both frontends read the API address from `VITE_API_URL` at build time. Include
`https://`; without it the browser treats the value as a relative path and every
API call returns the page's own HTML.

**Git-connected (recommended, deploys on every push).** In the dashboard, go to
Workers and Pages, then Create, Pages, Connect to Git. Create two projects from
the same repository:

| Setting | Website | Admin panel |
| --- | --- | --- |
| Root directory | `apps/web` | `apps/admin` |
| Build command | `npm run build` | `npm run build` |
| Output directory | `dist` | `dist` |
| `VITE_API_URL` | the API URL | the API URL |
| `API_URL` | the API URL | not needed |

`API_URL` is a runtime variable read by `apps/web/functions/_middleware.js`, which
fills in link-preview tags for crawlers that do not run JavaScript.

Under Settings, Builds, Watch paths, set `apps/web/*` for the website and
`apps/admin/*` for the admin panel, so profile README commits do not rebuild
both projects.

**Direct upload (no Git connection).** Build and upload from your machine:

```bash
# Website. Run from apps/web so wrangler finds ./functions.
cd apps/web
VITE_API_URL=https://<api-url> npm run build
npx wrangler pages deploy dist --project-name=portfolio-web

# Admin panel
cd ../admin
VITE_API_URL=https://<api-url> npm run build
npx wrangler pages deploy dist --project-name=portfolio-admin
```

On Windows PowerShell, set the variable first:
`$env:VITE_API_URL="https://<api-url>"; npm run build`

The website build runs `npm run bake` first, which pre-computes the snow
textures and terrain heightfield into `apps/web/public/baked/`. Those files are
generated and git-ignored, so the build must run `bake` (it does by default).
Skipping it makes the 3D world generate them in the browser instead, which adds
several seconds to the first load.

### 7. Allow the frontends to call the API

The admin panel sends a session cookie, so its origin must be listed explicitly
(credentialed requests cannot use a wildcard). Edit `ALLOWED_ORIGINS` in
`apps/api/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "https://<website>.pages.dev,https://<admin>.pages.dev,http://localhost:5173"
```

Include every custom domain too. Then redeploy the API:

```bash
npx wrangler deploy
```

If you skip this, the admin panel signs in and then every request fails.

### 8. Sign in and add your content

Open the admin panel URL, sign in with `ADMIN_PASSWORD`, and replace the starter
content: profile, projects, stack, socials and copy. The website shows your data
as soon as it is saved.

### 9. Publish the GitHub profile README (optional)

The sync writes to the file named by `README_PATH` (default `PROFILE.md`). To put
it on your GitHub profile, set `GITHUB_REPO` to your `<username>/<username>` repo
and `README_PATH` to `README.md`, then redeploy the API.

Create a fine-grained token for your profile repository only, with Contents set
to read and write (see `docs/GITHUB-TOKEN.md`), and store it as `GITHUB_TOKEN`.
In the admin panel choose Publish, then Publish now. The Worker also re-syncs on
a schedule every 30 minutes.

---

## Deploying the API from Cloudflare (Workers Builds)

If you connect the repository to the Worker instead of running `wrangler deploy`
yourself, set these in Workers and Pages, your worker, Settings, Build:

| Setting | Value |
| --- | --- |
| Root directory | `apps/api` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build variable `D1_DATABASE_ID` | your D1 id |
| Build variable `KV_NAMESPACE_ID` | your KV id |

`wrangler.toml` is git-ignored, so the build command generates it from
`wrangler.example.toml` using those two variables.

Cloudflare installs dependencies with `npm clean-install`. If a build fails at
"Installing" with "Missing: ... from lock file", the lockfile is out of sync:
run `npm install` in the repository root and commit `package-lock.json`.

Apply migrations yourself with `npm run db:migrate`; the build does not run them.

---

## Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then edit the values
npm run db:local          # create the local database
npm run dev:api           # API on http://localhost:8787
npm run dev:web           # website on http://localhost:5173
npm run dev:admin         # admin panel on http://localhost:5174
```

The dev servers proxy `/api`, `/media` and `/svg` to the local API. To point a
local frontend at a deployed API instead, set `API_PROXY=https://<api-url>` and
`VITE_API_URL=` (empty) when starting Vite.

---

## Verification checklist

1. `curl https://<api-url>/api/public/site` returns JSON.
2. `https://<api-url>/svg/status.svg` renders. Change the status in the admin
   panel and reload it; it updates without a commit.
3. The website loads and the admin panel signs in and saves.
4. `curl -s https://<website> | grep -E '<title>|og:title'` shows your title,
   not the placeholder from `index.html`.

## Troubleshooting

- **Admin panel signs in, then every request fails.** `ALLOWED_ORIGINS` is
  missing the admin origin (step 7).
- **`Unexpected token '<'` on the website.** `VITE_API_URL` has no `https://`.
- **`Authentication error [code: 10000]` from wrangler.** You are logged in to a
  different Cloudflare account than the one that owns the Worker. Run
  `npx wrangler whoami`, then log out and in, or set `CLOUDFLARE_ACCOUNT_ID`.
- **Cloudflare build fails at "Installing".** Out-of-sync `package-lock.json`;
  see the Workers Builds section above.
- **"duplicate column name" when running SQL by hand.** You ran a file from
  `apps/api/migrations-legacy/` against a database that already has it. Use
  `npm run db:migrate` instead.

## Notes and limits

- GitHub proxies README images and caches them, so the status card can lag a few
  minutes behind the admin panel.
- D1's free tier is about 5 million reads a day. KV caching keeps normal traffic
  far below that.
- The session cookie is `SameSite=None; Secure`, so the admin panel only works
  over HTTPS. Browsers make an exception for `localhost`.
- Databases created before the baseline migration existed used the numbered
  files in `apps/api/migrations-legacy/`. They are kept for reference and are not
  needed for new installs.
