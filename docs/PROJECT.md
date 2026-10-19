# Portfolio Platform

A dynamic portfolio you can edit from a browser. It has a public website with an
interactive 3D arctic scene, an admin panel for all of the content, and an API that
can also publish a GitHub profile README. It runs entirely on Cloudflare's free tier.

Edit your content once in the admin panel, and the website and your GitHub profile
both update.

## Features

- **Public website.** A minimal editorial layout with sections for projects, stack,
  experience, education and contact, plus an "Ask about me" assistant.
- **Immersive 3D world.** A scroll-driven React Three Fiber scene at `/world`: an
  igloo in the snow, a cinematic scroll cut, a selected-work page and a particle
  contact room.
- **Admin panel.** Edit the profile, projects, tech stack, socials, education,
  experience, status and every piece of site copy, and upload images.
- **Ask about me.** A chat assistant, powered by Workers AI, that answers only from
  your own content.
- **GitHub profile sync.** Renders a Markdown README with live SVG status cards and
  pushes it to your repository, only when the content actually changed.
- **Link previews.** A Pages Function injects your live title and description into
  the HTML so crawlers that do not run JavaScript still see them.

## Architecture

```
Admin panel --write--> Worker API --> D1 (source of truth)
                           |           |
                           |           +--read--> Public website
                           |
                           +--render--+--push--> GitHub README (optional)
                                      +--serve--> live SVG cards
```

| Part | Path | Stack |
| --- | --- | --- |
| API | `apps/api` | Cloudflare Worker, Hono, D1, KV, R2, Workers AI |
| Website | `apps/web` | React 19, Vite, React Three Fiber, three.js |
| Admin panel | `apps/admin` | React 19, Vite |
| Design tokens | `packages/tokens` | Shared CSS used by the website and admin |

Read `docs/ARCHITECTURE.md` for how the pieces fit together.

## Quick start

You need Node.js 20 or newer and a free Cloudflare account.

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
npm install
npm run setup
```

`npm run setup` signs in to Cloudflare, creates the D1 database, KV namespace and R2
bucket, runs the database migration, stores your secrets, and deploys the API. It
then tells you how to create the two Pages projects for the website and admin panel.

## Manual deployment

If you would rather run each step yourself:

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create portfolio
npx wrangler kv namespace create CACHE
npx wrangler r2 bucket create portfolio-media
cp wrangler.example.toml wrangler.toml     # then paste in the D1 and KV ids
npm run db:migrate                         # creates the schema and starter content
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

Then deploy the website and admin panel to Cloudflare Pages and allow their origins in
the API. The full walkthrough, with every setting, is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars    # edit the values
npm run db:local        # create the local database
npm run dev:api         # API      http://localhost:8787
npm run dev:web         # website  http://localhost:5173
npm run dev:admin       # admin    http://localhost:5174
```

The 3D world is at `http://localhost:5173/world`.

## Database

The schema lives in `apps/api/migrations/`. `0001_init.sql` creates every table and
adds neutral starter content, and is safe to run more than once. To change the schema,
add a new numbered file, for example `0002_add_field.sql`, and run
`npm run db:migrate`. Databases created before the baseline existed used the files in
`apps/api/migrations-legacy/`, which new installs do not need.

## Project structure

```
apps/
  api/        Worker: routes, D1 access, GitHub sync, SVG cards, migrations
  web/        Website and 3D world, Pages Function for link previews
  admin/      Admin panel
packages/
  tokens/     Shared design tokens
docs/         Architecture, deployment, manual steps, GitHub token guide
scripts/      Guided setup and asset tooling
```

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): deploy with the script or by hand
- [`docs/MANUAL-STEPS.md`](docs/MANUAL-STEPS.md): the steps that cannot be scripted
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the system is put together
- [`docs/GITHUB-TOKEN.md`](docs/GITHUB-TOKEN.md): the token for the profile README sync

## Profile README sync

The Worker writes the generated profile README to the file named by `README_PATH`
(`PROFILE.md` by default, so it never overwrites this README). To publish it on your
GitHub profile, create the `<username>/<username>` repository, set `GITHUB_REPO` to
it and `README_PATH` to `README.md` in `apps/api/wrangler.toml`, and add a GitHub
token as described in `docs/GITHUB-TOKEN.md`. This part is optional.

## License

MIT. See [`LICENSE`](LICENSE). You are free to use, modify and distribute this
project, including for your own portfolio.
