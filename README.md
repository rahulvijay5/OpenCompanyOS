# OpenCompanyOS

Open-source organizational context layer for AI agents. MVP is GitHub-only.

**Do not build the AI layer first.** Make GitHub App installation → repository
selection → initial sync → webhook ingestion reliable before RAG/agents.

## Specs:

[`docs/GITHUB_LOCAL_SETUP.md`](docs/GITHUB_LOCAL_SETUP.md)

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
**canonical entities and relationships**, plus **search / embeddings / query**.

`POST /api/v1/query` retrieves with Postgres full-text search and pgvector, then
asks a model to answer only from those snippets. Models go through a
[LiteLLM](https://docs.litellm.ai/docs/) proxy (`LITELLM_BASE_URL`), so Gemini,
Groq, or another provider is a config change: set `CHAT_MODEL` to `gemini` or
`groq` and put the provider key in `.env`. Without `LITELLM_BASE_URL`, keyword
retrieval still runs and the API refuses to invent an answer.

```bash
docker compose up -d   # postgres + LiteLLM on :4001
```

Next: temporal change detection and evaluation.
