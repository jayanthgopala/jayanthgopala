# GitHub token

The Worker needs a token to commit `README.md` to your profile repo. This token is the
single most sensitive thing in the system, so scope it as narrowly as GitHub allows.

## Create the profile repo first

The profile README lives in a repo **named exactly like your username**.

1. New repository → name it `jayanthgopala` (your handle, character for character)
2. Public, and tick **Add a README file** — the sync needs a `main` branch to exist
3. Create

GitHub will show a "special repository" note. That is the one.

## Create a fine-grained token

**Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new**

| Field | Value |
| :--- | :--- |
| Token name | `portfolio-readme-sync` |
| Expiration | 90 days (calendar a rotation) |
| Resource owner | your account |
| Repository access | **Only select repositories** → pick `jayanthgopala` only |
| Permissions → Repository → **Contents** | **Read and write** |
| Everything else | leave at *No access* |

Contents is the only permission required. If the token can do more than write one file in
one repo, it is over-scoped — a leaked Worker secret should cost you a README, nothing more.

> Do **not** use a classic token. Classic `repo` scope grants write access to every
> repository you can push to, including private ones.

## Store it

```bash
cd apps/api
wrangler secret put GITHUB_TOKEN     # paste when prompted
```

Locally, put it in `apps/api/.dev.vars` — that file is git-ignored. Leave it blank to
develop without pushing; the API returns a clear error instead of failing obscurely.

The token is never sent to either frontend. It exists only in the Worker's secret store,
and only `lib/github.js` reads it.

## Verify

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" https://<your-api>/api/admin/github/check
```

`{"ok":true,"user":{...}}` means the token works. The **Publish** tab in the admin panel
shows the same check as a status pill, so a bad or expired token is visible before you
need it — not at the moment you press Publish.

## Rotation

Fine-grained tokens expire. When yours does, the sync log will fill with `401` entries and
the Publish tab will show *Token invalid*. Generate a new token with the same settings and
re-run `wrangler secret put GITHUB_TOKEN`. No redeploy needed.
