# Deployment

Three independent deploys: the Worker API, the website, and the admin panel.
All on Cloudflare's free tier.

## 0. Prerequisites

```bash
npm install
npx wrangler login
```

## 1. Provision the resources

```bash
cd apps/api

npx wrangler d1 create portfolio
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create portfolio-media
```

Each command prints an id. Paste them into `apps/api/wrangler.toml`:

```toml
[[d1_databases]]
database_id = "<the d1 id>"

[[kv_namespaces]]
id = "<the kv id>"
```

While you're in that file, set `GITHUB_USER` and `GITHUB_REPO` to your handle
(both are the same value — the profile repo is named after you).

## 2. Create the schema

```bash
npm run db:remote     # applies schema.sql to the live D1 database
```

> `schema.sql` starts with `DROP TABLE IF EXISTS`. It is a **first-run** script — running
> it again wipes your content. For later changes, use an incremental migration.

Migrations live in `apps/api/migrations/` and are safe to re-run (`CREATE TABLE IF NOT
EXISTS`, `INSERT OR IGNORE`), so they never clobber copy you have already edited:

```bash
npx wrangler d1 execute portfolio --remote --file=./migrations/001-add-content.sql
npx wrangler d1 execute portfolio --remote --file=./migrations/002-cinematic-mode.sql
```

> 002 runs `ALTER TABLE content ADD COLUMN options`. D1 has no `ADD COLUMN IF NOT EXISTS`,
> so re-running it errors with *"duplicate column name"* — that means it was already
> applied and is safe to ignore. The `INSERT OR IGNORE` rows below it are re-runnable.

Run these only if your database predates the migration — a fresh `schema.sql` already
includes everything.

## 3. Set the secrets

```bash
cd apps/api
npx wrangler secret put ADMIN_PASSWORD    # your admin panel password
npx wrangler secret put JWT_SECRET        # 32+ random chars, e.g. openssl rand -base64 32
npx wrangler secret put GITHUB_TOKEN      # see docs/GITHUB-TOKEN.md
```

## 4. Deploy the API

```bash
npm run deploy:api      # from the repo root
```

Note the deployed URL, then set it as `PUBLIC_API_URL` in `wrangler.toml` and redeploy.
That value is what the README's live SVG `<img>` tags point at — if it's wrong, the cards
render as broken images on your profile.

## 5. Deploy the frontends

Both read the API URL from `VITE_API_URL` at build time.

```bash
# Website
cd apps/web
VITE_API_URL=https://portfolio-api.<subdomain>.workers.dev npm run build
# Run from apps/web — wrangler picks up ./functions relative to the CWD,
# not from inside dist/. That directory is the SEO middleware.
npx wrangler pages deploy dist --project-name=portfolio-web

# Admin panel
cd ../admin
VITE_API_URL=https://portfolio-api.<subdomain>.workers.dev npm run build
npx wrangler pages deploy dist --project-name=portfolio-admin
```

On Windows PowerShell, set the variable first:
`$env:VITE_API_URL="https://…"; npm run build`

## 5b. Set `API_URL` for the website's SEO middleware

`apps/web/functions/_middleware.js` rewrites `<head>` at the edge so link previews
on LinkedIn, Slack, X and WhatsApp use your live title and description — those
crawlers read raw HTML and never execute JavaScript, so the React-side update
alone does not reach them.

It needs a **runtime** variable (separate from the build-time `VITE_API_URL`):

**Cloudflare dashboard → Pages → portfolio-web → Settings → Environment variables**

| Name | Value |
| :--- | :--- |
| `API_URL` | `https://portfolio-api.<subdomain>.workers.dev` |

Without it the middleware exits early and serves the static tags — degraded, not broken.

Verify with:

```bash
curl -s https://portfolio-web.pages.dev | grep -E '<title>|og:title'
```

That must show your live title, not the placeholder baked into `index.html`.

## 6. Close the CORS loop

The admin panel sends its session cookie, so its origin must be allow-listed explicitly —
credentialed requests cannot use a wildcard. Update `ALLOWED_ORIGINS` in `wrangler.toml`
with **both** deployed origins and redeploy the API:

```toml
ALLOWED_ORIGINS = "https://portfolio-web.pages.dev,https://portfolio-admin.pages.dev"
```

Miss this and the panel logs in but every subsequent request returns 401.

## 7. Publish your profile

Open the admin panel → **Publish** → confirm the pill shows `@yourname` → **Publish now**.

Check `github.com/<you>` — the README should be live, with the status card rendering
as an image.

---

## Verification checklist

1. `curl https://<api>/api/public/site` returns your content.
2. Open `https://<api>/svg/status.svg` — it renders the current status. Change the status in
   the admin panel, reload the SVG: it updates **with no commit**.
3. Trigger the cron twice:
   ```bash
   npx wrangler dev --test-scheduled
   curl "http://localhost:8787/cdn-cgi/handler/scheduled"
   ```
   The first run publishes if content changed; the second is a no-op because the content
   hash is unchanged. `GET /api/admin/sync/state` shows both hashes.
4. Lighthouse the deployed site: performance, accessibility, best practices, SEO.
5. Enable *Reduce motion* in your OS and reload — the background blobs freeze, reveals are
   instant, and card tilt is disabled.

## Notes and limits

- **Camo caching.** GitHub proxies README images and caches them aggressively. Your status
  card may lag a few minutes behind the admin panel. Expected, not a bug.
- **D1 free tier** is ~5M reads/day. KV caching keeps normal traffic far below that; the
  cache version bumps on write, so edits still appear within the 60s TTL.
- **Cookies.** The session cookie is `SameSite=None; Secure`, required for a cross-origin
  admin panel. It therefore only works over HTTPS — browsers make an exception for
  `localhost`, which is why local dev works.
- **`schema.sql` is destructive.** See step 2.
