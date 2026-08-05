# Manual steps

Everything that *can* be scripted is. This file is the remainder — the steps a
setup script cannot do for you, and why each one resists automation.

Deliberately not in the root `README.md`: on a repo named after its owner, that
file is the GitHub **profile** README and is generated from the database. Anything
written there gets overwritten by the next sync, and shows up on a profile page.

---

## 1. Cloudflare login

One click, but it has to be yours.

`wrangler login` opens a browser and waits for you to approve the OAuth grant.
A script can *launch* it and detect whether you are already logged in
(`wrangler whoami`), but it cannot click the button.

**No browser available** (CI, WSL without a bridge, a server over SSH): skip the
login entirely and export an API token instead.

```
export CLOUDFLARE_API_TOKEN=...
```

**More than one Cloudflare account:** wrangler cannot guess which to use and will
stop. Export the account you want.

```
export CLOUDFLARE_ACCOUNT_ID=...
```

---

## 2. GitHub token

Needed only for the profile README sync. Everything else runs without it, so you
can skip this and come back — the site works, the profile just stops updating.

Tokens cannot be minted programmatically. Create a **fine-grained** personal
access token by hand:

- **Repository access** — only the profile repo (`<username>/<username>`).
  Not "all repositories". This token can rewrite whatever it can reach.
- **Permissions** → **Contents** → **Read and write**. Nothing else.

Then either paste it when the setup script asks, or set it later:

```
npx wrangler secret put GITHUB_TOKEN
```

The Worker also expects two other secrets, which the script does handle:
`ADMIN_PASSWORD` (yours to choose) and `JWT_SECRET` (generated for you).

---

## 3. The two Pages projects

**This is the big one, and it is dashboard-only on purpose.**

`wrangler pages deploy` exists, so it looks automatable. It is not the same
thing: it performs a *direct upload*, producing a project with **no Git
connection** — no deploy on push, and no build watch paths. Connecting a
repository to a Pages project can only be done in the dashboard. Scripting it
would quietly hand you a worse deployment than the one you wanted.

Create two projects from **Workers & Pages → Create → Pages → Connect to Git**,
both pointing at this same repository.

### Public site

| Setting | Value |
| --- | --- |
| Root directory | `apps/web` |
| Build command | `npm run build` |
| Output directory | `dist` |

Environment variables:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | the Worker URL printed at the end of setup |
| `API_URL` | the same URL — read by the Pages Function that injects SEO tags |

### Admin panel

| Setting | Value |
| --- | --- |
| Root directory | `apps/admin` |
| Build command | `npm run build` |
| Output directory | `dist` |

Environment variables:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | the Worker URL |

> **Include the scheme.** `portfolio-api.example.workers.dev` without `https://`
> is treated as a *relative* path by the browser, so every API call returns the
> SPA's own `index.html` and the site dies with
> `Unexpected token '<', "<!doctype"`. It looks like an outage, not a typo.

### Build watch paths

Set these on **both** projects, under Settings → Builds → Watch paths:

- public site → `apps/web/*`
- admin panel → `apps/admin/*`

Without them, every commit rebuilds both projects — including the automated
`chore(profile): sync from admin panel` commits, which touch only `README.md`.
The admin panel then 403s for the five or six minutes each rebuild takes, for a
change that affected neither frontend.

---

## 4. `ALLOWED_ORIGINS` — a second pass, unavoidably

A genuine chicken-and-egg, not an oversight:

- the frontends need the Worker's URL, which does not exist until the backend is
  deployed;
- the Worker's `ALLOWED_ORIGINS` needs the Pages URLs, which do not exist until
  the frontends are deployed.

So the order is: **deploy backend → create the Pages projects → come back and add
their URLs.** Until you do, the admin panel logs in and then fails every request,
because credentialed CORS cannot use a wildcard origin — the browser blocks it.

Edit `ALLOWED_ORIGINS` in `apps/api/wrangler.toml` and redeploy. Include every
origin that will talk to the API — apex, `www`, both `*.pages.dev` fallbacks, any
custom domains, and the localhost ports for development.

---

## 5. Custom domain and DNS

Dashboard, per Pages project: **Custom domains → Set up a domain**.

If the domain is already on Cloudflare the records are added for you; if it is
registered elsewhere you will be moving nameservers, which is a decision rather
than a command.

Adding a domain here means adding it to `ALLOWED_ORIGINS` too (§4).

---

## 6. Search engines

- **Google Search Console** — verification needs a meta tag or DNS record tied to
  your account. Paste the tag into the `seo.verification` content key, publish,
  then verify.
- Submit `https://<your-domain>/sitemap.xml` once verified.

Neither can be done on your behalf.

---

## 7. Make it yours (forks)

The setup script re-seeds the database with your details, so the *content* is
handled. Two things it cannot decide for you:

- **The profile README.** A fork carries the original author's `README.md`. On a
  repo named after you, that renders on your GitHub profile — someone else's
  identity on your account — until the first sync from your own admin panel
  replaces it.
- **Bundled assets.** The portrait at `apps/web/public/character.jpg` and the
  favicon ship in the repo, not the database. Replace them, or upload your own
  portrait from the admin panel, which takes precedence.
