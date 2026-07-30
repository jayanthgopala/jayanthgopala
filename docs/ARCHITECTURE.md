# Portfolio Platform

A dynamic portfolio website with an admin panel that **also publishes your GitHub profile README**.

Edit content once in the admin panel. The website and `github.com/<you>/<you>` both update.

```
Admin panel ──write──> Worker API ──> D1  (source of truth)
                           │           │
                           │           ├──read──> Public website
                           │           │
                           └──render───┴──push──> github.com/<you>/<you>/README.md
                                                     └─ embeds live <img> SVGs
                                                        served by the Worker
```

## Why two sync mechanisms

| Mechanism | Handles | Cost |
| :--- | :--- | :--- |
| **README push** (GitHub Contents API) | Projects table, stack, bio, links | One commit per real change |
| **Live SVG cards** (`/svg/status.svg`) | Current project, deploy state, uptime | **Zero commits** — re-rendered per request |

Push-only would leave volatile fields stale, or spam your contribution graph with empty commits.
SVG-only can't render tables or links. Together you get a live profile *and* a clean history.

A **cron trigger** (every 30 min) re-pushes only when a SHA-256 hash of the README-relevant
content differs from the last published one — so a failed push self-heals, and unchanged
content never commits.

## Layout

```
portfolio/
├── apps/
│   ├── api/      Cloudflare Worker — Hono, D1, KV, R2, GitHub sync   (own deploy)
│   ├── web/      Public website — React 19 + Vite, .jsx              (own deploy)
│   └── admin/    Admin panel — React 19 + Vite, .jsx                 (own deploy)
└── packages/
    └── tokens/   Shared design tokens — consumed by web and admin
```

Backend, website and admin panel deploy independently. The only thing they share is
`packages/tokens/tokens.css`, so the two frontends can't drift apart visually.

## Quick start

```bash
npm install

# 1. Create the Cloudflare resources (see docs/DEPLOYMENT.md for the full walkthrough)
#    then paste the returned ids into apps/api/wrangler.toml

# 2. Local secrets
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then edit it

# 3. Seed the local database
npm run db:local

# 4. Run all three (separate terminals)
npm run dev:api      # http://localhost:8787
npm run dev:web      # http://localhost:5173
npm run dev:admin    # http://localhost:5174
```

## API surface

**Public** (KV-cached, no auth)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| GET | `/api/public/site` | Everything the website renders, in one payload |
| GET | `/api/public/status` | Live status card only (polled every 60s) |
| GET | `/api/public/projects` | Published projects |
| GET | `/svg/status.svg` | Live status card for the README |
| GET | `/svg/metrics.svg` | Live metrics card for the README |
| GET | `/media/:key` | R2-hosted screenshots |

**Auth**

| Method | Path |
| :--- | :--- |
| POST | `/api/auth/login` · `/api/auth/logout` |
| GET | `/api/auth/me` |

**Admin** (JWT — httpOnly cookie or `Authorization: Bearer`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| GET/PUT | `/api/admin/profile` · `/api/admin/status` | Singleton content |
| GET/POST/PATCH/DELETE | `/api/admin/projects[/:id]` | Projects |
| POST | `/api/admin/projects/reorder` | Full ordered id list |
| GET/POST/PATCH/DELETE | `/api/admin/stack[/:id]` · `/api/admin/socials[/:id]` | Lists |
| POST | `/api/admin/media` | Upload a screenshot to R2 |
| GET | `/api/admin/readme/preview` | Rendered Markdown |
| POST | `/api/admin/sync` | Force-publish to GitHub |
| GET | `/api/admin/sync/state` | Current vs published content hash |
| GET | `/api/admin/sync/log` | Push history with commit SHAs |
| GET | `/api/admin/github/check` | Verify the PAT works |

Every admin write bumps the KV cache version and fires a background sync via
`ctx.waitUntil` — the panel returns immediately, GitHub updates behind it.

## Everything is editable

There is no copy baked into the JSX. Beyond the obvious content (profile, projects,
stack, links, status), the `content` table holds every fixed string — section
headings, nav labels, status-card row labels, the footer note, SEO tags and the
README headings — edited from **Admin → Copy**.

The form is generated from the rows, so adding a key to the database surfaces a
field in the panel with no code change:

```sql
INSERT INTO content (key, value, group_name, label, sort_order)
VALUES ('contact.button', 'Say hello', 'Contact section', 'Button label', 4);
```

Components read it through `copy(content, key, fallback)`. The fallback is not
decoration — it renders during the first paint before the payload lands, and on a
database that predates a newly added key, so the page never flashes blank labels.

**The one deliberate exception** is `ErrorBanner`, which stays hardcoded. It is what
shows when the API is unreachable, and fetching the copy for "cannot fetch copy"
would leave a blank box exactly when the user most needs a message.

### SEO and link previews

`apps/web/functions/_middleware.js` rewrites `<head>` at the edge with HTMLRewriter.

This matters because the site is client-rendered: Google executes JavaScript and would
eventually see React's update, but the crawlers behind link previews — LinkedIn, Slack,
X, WhatsApp, Discord — read the raw HTML response and never run a line of JS. Setting
the tags from React fixes search but leaves every shared link showing stale text.

Needs `API_URL` set on the Pages project (see `docs/DEPLOYMENT.md` §5b). Unset, it
exits early and serves the static tags — degraded, not broken.

## Two modes, one site

The site ships two presentations over the same content and the same DOM:

| | **Minimal** | **Cinematic** |
| :--- | :--- | :--- |
| Hero | Split layout, headline left, status card right | Character centred, headline **flanking both edges** |
| Signature | Ambient gradient blobs | Scroll-scrubbed **push-in to the eye**, then a statement resolves |
| Nav | Full-width bar, glass on scroll | Floating glass **pill** |
| Accent | Iris `#6E7BFF` | Cyan `#3ecfd5` |
| Intro | — | Preloader with % counter |

Switching is a single `data-mode` attribute on `<html>`; `cinematic.css` overrides tokens
and components from there. No duplicated markup, and content edits apply to both.

**Resolution order** — visitor's saved choice → `theme.default` from the admin panel →
`minimal`. The admin default sets the *first* impression; a visitor who chooses for
themselves keeps that choice.

The preloader shows **once per browser session**, not per page load. An entrance animation
is a first impression; re-running it on every navigation turns a flourish into a toll booth.

### The push-in shot

`CinematicHero` is a **tall scene wrapping a `position: sticky` stage**, not a 100vh hero.
Progress is measured from the scene's own rect, giving the shot a fixed scroll budget:

| Progress | Beat |
| :--- | :--- |
| 0.00–0.28 | Flanking headline fades out |
| 0.00–0.80 | Camera pushes into the eye (`transform-origin: 45% 19%`) |
| 0.50–0.82 | Figure dissolves |
| 0.58–0.86 | Statement fades up |

Two details that are load-bearing:

- The zoom transform is on the **`<img>`**, not the wrapper. A percentage `transform-origin`
  resolves against its own box, and the wrapper is a different aspect ratio — the same
  percentages there land on his shoulder.
- The figure **dissolves** as the zoom peaks. That is not just a transition; it hides the
  resolution loss of a 932px-wide source pushed to 4.4×.

Under `prefers-reduced-motion` the scene collapses to `100svh` and the reveal is removed —
progress is never computed, so a tall scene would otherwise leave a viewport and a half of
dead scroll under a static image.

### The character asset

`public/character.jpg` is the render with its studio backdrop **cut away** (border-seeded
region growing) and the subject **composited onto this theme's exact `--bg`**. A
transparent PNG was 13× the size for an identical result on a solid background — 1.2 MB
versus 158 KB.

> If `--bg` is ever retuned, the baked-in backdrop stops matching and a seam appears.
> Regenerate the asset rather than reaching for a CSS mask.

Uploading a Hero portrait in the admin panel overrides it. In minimal mode the same asset
is re-cropped to the head via `transform-origin: 50% 0%` on the orb — `scale()` zooms about
the element's centre by default, which drags the crop down past the face.

## Design language

Defined once in `packages/tokens/tokens.css`.

- **Surface** `#08080A` base, `#0D0D10` elevated. Near-black, not pure black — pure `#000`
  bands the gradients on OLED and flattens the depth.
- **Accents** desaturated: iris `#6E7BFF`, violet `#A78BFA`, mint `#63D2C3`, amber `#F5B45C`.
  Saturation is spent on one focal point per viewport.
- **Glass** only on the nav and the status card. Blur over an empty hero is blur for its own sake.
- **Radii** 12 / 16 / 20 / 24 / 32px.
- **Type** Inter (Geist first if present), fluid `clamp()` scale, hero to 6.5rem.
- **Motion** one easing curve — `cubic-bezier(.16,1,.3,1)` — at 180 / 280 / 600ms.

### Animation without a library

`apps/web/src/lib/motion.jsx` provides reveal-on-scroll, ≤4° card tilt, pointer ripple and
scroll state in ~150 lines. Every effect the brief asks for is a transform or an opacity
change, which CSS already does on the compositor — the hook only supplies the *trigger*.
That is the whole reason Framer Motion (~34KB gz) isn't a dependency. Swapping it in later
means replacing one file.

Everything degrades under `prefers-reduced-motion` — the drifting background blobs stop
entirely rather than merely running faster, since a moving blur is exactly what triggers
vestibular discomfort.

## Documentation

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — provisioning and deploying all three apps
- [`GITHUB-TOKEN.md`](./GITHUB-TOKEN.md) — creating a correctly-scoped PAT

---

> **Why this file isn't `README.md`.** This repo is also the GitHub *profile* repo
> (`jayanthgopala/jayanthgopala`), so its `README.md` is generated from the admin panel
> and republished by the sync engine — anything written there by hand gets overwritten on
> the next publish. The architecture docs live here instead, where they survive.
