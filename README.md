# OpenCompanyOS

Open-source organizational context layer for AI agents. The MVP is GitHub-only:
connect an organization, sync repositories, keep new activity through webhooks,
and ask what changed with stored evidence beside the answer.

## Specs

[`docs/GITHUB_LOCAL_SETUP.md`](docs/GITHUB_LOCAL_SETUP.md)

## Stack

pnpm workspaces · Fastify API · Next.js web · worker · Drizzle · PostgreSQL · pgvector · LiteLLM

## Quick start

```bash
cp .env.example .env
# fill GitHub App credentials (see docs/GITHUB_LOCAL_SETUP.md)

pnpm install
docker compose up -d
pnpm db:migrate
pnpm --filter @opencompanyos/config build
pnpm --filter @opencompanyos/db build
pnpm --filter @opencompanyos/github build
pnpm --filter @opencompanyos/retrieval build
pnpm --filter @opencompanyos/sync build
pnpm dev
```

- Home: http://localhost:3000
- Workspace: http://localhost:3000/app
- API: http://localhost:4000
- Health: `GET /health`, readiness: `GET /ready`
- Webhooks: `POST /api/webhooks/github` (requires a public tunnel — see the setup doc)
- LiteLLM proxy: http://localhost:4001 (`docker compose up -d` starts Postgres and LiteLLM)

## Demo

1. Open `/app` and connect the GitHub App. After GitHub redirects, you land back on `/app`.
2. Select `opencompanyos-org/company-brain` (or your own repo) and start a sync.
3. Ask “What changed this week?”. The answer cites stored rows. A question the index cannot support says so.
4. Open an entity to see its current snapshot, occurrence timeline, and relationships. Open a change to see that occurrence beside the current snapshot.

`/` is the front door. The workspace stays at `/app`.

Issues and pull requests from the initial sync are snapshots of current state. Webhook transitions after install are occurrences and show up under Changes. Commits, comments, and reviews are occurrences already.

## Query

`POST /api/v1/query` uses Postgres full text and pgvector, then asks a model to answer only from those snippets. Models go through a [LiteLLM](https://docs.litellm.ai/docs/) proxy (`LITELLM_BASE_URL`). Set `CHAT_MODEL` to `gemini` or `groq` and put the provider key in `.env`. The response includes `latencyMs`, `inputTokens`, and `outputTokens`.

Change questions also attach occurrence rows from the requested time window.

## Evaluation

`pnpm eval` checks the indexed context on a running API. It confirms the repository entity, that a repository timeline is made of occurrences, and that the change feed stays inside the last 7 days. It does not call a model.
