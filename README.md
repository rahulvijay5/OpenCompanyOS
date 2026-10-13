# OpenCompanyOS

Open-source organizational context layer for AI agents. The MVP is GitHub-only:
connect an organization, sync repositories, keep new activity through webhooks,
and ask what changed with stored evidence beside the answer.

## Specs

[`docs/GITHUB_LOCAL_SETUP.md`](docs/GITHUB_LOCAL_SETUP.md)

## Stack

pnpm workspaces · Fastify API · Next.js web · worker · Drizzle · PostgreSQL · pgvector · LiteLLM

## Quick start

Prerequisites: Docker, a GitHub App (see [`docs/GITHUB_LOCAL_SETUP.md`](docs/GITHUB_LOCAL_SETUP.md)), and a copy of the environment file.

```bash
cp .env.example .env
# fill the GitHub App values. Do not commit .env.

docker compose up --build
```

- Workspace: http://localhost:3000/app
- API health: `GET http://localhost:4000/health` (process is up)
- API readiness: `GET http://localhost:4000/ready` (process can reach Postgres)
- Stop: `docker compose down` (add `-v` only when you mean to delete the database volume)

`docker compose up --build` starts Postgres with pgvector, applies Drizzle migrations, then starts the API, web app, and worker. The worker polls `sync_jobs` and `webhook_deliveries` in Postgres. Redis is not part of this setup. LiteLLM is not started, and the API does not call a model, unless you opt in:

```bash
COMPOSE_LITELLM_BASE_URL=http://litellm:4000/v1 docker compose --profile llm up --build
```

Without a model, a question still returns stored evidence titles, links, timestamps, record kinds, and the coverage note.

### Host development

This leaves the app processes on the host and only starts Postgres:

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm --filter @opencompanyos/config build
pnpm --filter @opencompanyos/db build
pnpm --filter @opencompanyos/github build
pnpm --filter @opencompanyos/retrieval build
pnpm --filter @opencompanyos/sync build
pnpm --filter @opencompanyos/context build
pnpm dev
```

Do not bind host ports 3000, 4000, or 5432 to both the host processes and Compose at the same time.

## Demo

Start Compose, then use one repository. The credential checklist is [`docs/GITHUB_LOCAL_SETUP.md`](docs/GITHUB_LOCAL_SETUP.md).

1. `docker compose up --build`, then open http://localhost:3000/app.
2. Choose **Connect GitHub**. GitHub should return the browser to `/integrations/github/setup`, which sends you back to `/app` with the installation listed.
3. Select one repository, choose **Save selection**, then **Start sync**. Wait until the worker finishes. Recent activity lists that repository only.
4. Ask “What changed this week?”. The evidence panel is the block titled “Why am I seeing this?”.
5. Check the rolling UTC interval, each source link, the event time, and whether the row says Occurrence or Snapshot. A snapshot line says it is the current stored record, not a change during the interval.

Without LiteLLM, the answer says the model is unavailable and still lists the stored evidence. That is the expected demo. Do not start the `llm` profile for this walkthrough.

The first sync stores issues and pull requests as current snapshots. It does not rebuild history from before the install. Commits, comments, and reviews collected by that sync are occurrences. Inline review comments are not collected. An empty week with `untracked_coverage` means collection completeness is unverified, not that nothing happened.

Two checks are not part of this demo’s acceptance:

- The live GitHub Setup URL was not confirmed in the App settings. If the redirect does not return to this app, set the Setup URL to `http://localhost:3000/integrations/github/setup` and record the previous value so you can restore it.
- Live webhook delivery and duplicate redelivery are unverified. Activity that arrives only through a webhook is not part of the accepted demo.

## Query

`POST /api/v1/context` builds a versioned context package for the local tenant. `scope.authorization` is the literal `local-owner`: this prototype has one bootstrapped user and no per-user checks. Authentication is required before a second user or tenant. Repository scope is the installation's selected repositories. Requested repository ids are kept only when they are selected for that tenant.

`POST /api/v1/query` uses that same package. Postgres full text supplies evidence. When `LITELLM_BASE_URL` is unset, the answer lists stored evidence titles and the panel still shows provenance. When a [LiteLLM](https://docs.litellm.ai/docs/) proxy is configured, the model may cite evidence ids from the package. The server drops any other id and copies URLs from the stored records. The response includes `latencyMs`, `inputTokens`, `outputTokens`, and `uncertainties`.

Change questions also attach occurrence rows from the requested time window.

## Evaluation

`pnpm eval` checks the indexed context on a running API. It confirms the repository entity, that a repository timeline is made of occurrences, and that the change feed stays inside the last 7 days. It does not call a model.

`pnpm eval:context` scores a hand-authored ContextPackage fixture suite. It uses `EVAL_DATABASE_URL` and does not call a model or read the company-brain index. See [eval/context-quality/README.md](eval/context-quality/README.md).

The shipping query path is Postgres full text. An offline EmbeddingGemma comparison did not replace it. The measurements and the reason are in [`docs/EMBEDDINGGEMMA_RETRIEVAL.md`](docs/EMBEDDINGGEMMA_RETRIEVAL.md).
