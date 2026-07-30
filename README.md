<div align="center">

# Jayanth Gopala

### Building scalable software and exceptional digital experiences.

I design and ship production systems end to end — from edge APIs and data models to
interfaces that feel considered.

[![GitHub](https://img.shields.io/badge/GitHub-141414?style=for-the-badge&logo=github&logoColor=white)](https://github.com/jayanthgopala)&nbsp;[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/jayanthgopala)&nbsp;[![Email](https://img.shields.io/badge/Email-1a1a1a?style=for-the-badge&logo=gmail&logoColor=white)](mailto:jayanthgopala21@gmail.com)

</div>

<br />

> **This file is generated.** It gets replaced by the portfolio's admin panel on every
> publish — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how, and why editing it
> by hand won't stick. This placeholder just keeps the profile presentable until the first
> sync runs.

## What's in this repo

A dynamic portfolio platform whose admin panel publishes **both** the website and this
profile README from one database.

```
apps/api      Cloudflare Worker — Hono, D1, KV, R2, GitHub sync
apps/web      Public website — React 19 + Vite
apps/admin    Admin panel — React 19 + Vite
packages/     Shared design tokens
```

- **[Architecture](docs/ARCHITECTURE.md)** — how the three surfaces stay in sync
- **[Deployment](docs/DEPLOYMENT.md)** — provisioning and deploying
- **[GitHub token](docs/GITHUB-TOKEN.md)** — scoping the PAT correctly
