# OpenCompanyOS

Open-source organizational context layer for AI agents. MVP is GitHub-only.

**Do not build the AI layer first.** Make GitHub App installation → repository
selection → initial sync → webhook ingestion reliable before RAG/agents.

## Specs

1. [`docs/OPENCOMPANYOS_MASTER_SPEC.md`](docs/OPENCOMPANYOS_MASTER_SPEC.md) (also under `gitignore/` until promoted)
2. [`docs/GITHUB_LOCAL_SETUP.md`](docs/GITHUB_LOCAL_SETUP.md)
3. [`docs/CURSOR_TASK_STARTER.md`](docs/CURSOR_TASK_STARTER.md) when present

## Stack

pnpm workspaces · Fastify API · Next.js web · worker · Drizzle · PostgreSQL

## Quick start

```bash
cp .env.example .env
# fill GitHub App credentials (see docs/GITHUB_LOCAL_SETUP.md)

pnpm install
docker compose up -d
pnpm db:generate   # first time / after schema changes
pnpm db:migrate
pnpm --filter @opencompanyos/config build
pnpm --filter @opencompanyos/db build
pnpm --filter @opencompanyos/github build
pnpm --filter @opencompanyos/sync build
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000
- Health: `GET /health`, readiness: `GET /ready`
- Webhooks: `POST /api/webhooks/github` (requires public tunnel — see setup doc)

## Current milestone

GitHub App install → select repos → initial sync → webhook ingestion →
**canonical entities and relationships** (Person, Repository, Issue, PullRequest,
Commit, Comment plus AUTHORED / BELONGS_TO / MODIFIES / DISCUSSES / REVIEWED).

Next: search, embeddings, and the query API.
