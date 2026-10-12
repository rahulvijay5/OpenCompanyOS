# GitHub App Local Setup Checklist

## 1. Create GitHub App

Create a GitHub App in GitHub Developer Settings.

Set:
- Homepage: `http://localhost:3000`
- Setup URL: `http://localhost:3000/integrations/github/setup`
- Webhook URL: public HTTPS tunnel + `/api/webhooks/github` (see §3)
- Webhook secret: generate a strong random value → put in `GITHUB_WEBHOOK_SECRET`

Read permissions (MVP):
- Repository metadata: read
- Contents: read
- Issues: read (`GET /repos/{owner}/{repo}/issues/comments` is included)
- Pull requests: read (`GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` is included)

Inline review comments, linked issues, and file contents are not backfilled.

Subscribe to webhook events:
- `installation`
- `installation_repositories`
- `push`
- `pull_request`
- `issues`
- `issue_comment`
- `pull_request_review`
- `pull_request_review_comment` (stored as ignored until normalized)

## 2. Run OpenCompanyOS

Compose is the supported demo. From a checkout with `.env` filled in:

```bash
docker compose up --build
```

Readiness:

```bash
curl -fsS http://localhost:4000/health
curl -fsS http://localhost:4000/ready
```

`/health` means the API process is listening. `/ready` means it can query Postgres. Migrations run in a one-shot `migrate` service before the API and worker start, and Drizzle skips migrations that are already applied.

Shutdown:

```bash
docker compose down
```

Host development, when you want `pnpm dev` instead of the API and web containers:

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm --filter @opencompanyos/config build
pnpm --filter @opencompanyos/db build
pnpm --filter @opencompanyos/github build
pnpm --filter @opencompanyos/sync build
pnpm --filter @opencompanyos/context build
pnpm dev
```

The worker is required for **Start sync**. In Compose it is the `worker` service. On the host it starts as part of `pnpm dev`. It reads jobs from Postgres. It does not use Redis.

LiteLLM is optional. Omit it and answers list stored evidence without a generated summary. To start the proxy:

```bash
COMPOSE_LITELLM_BASE_URL=http://litellm:4000/v1 docker compose --profile llm up --build
```

That profile calls a hosted model only when `GEMINI_API_KEY` or `GROQ_API_KEY` is set. The basic demo does not need it.

### GitHub App URLs for Compose

The browser uses the published host ports. Containers talk to each other by service name (`postgres`, `api`).

| Setting | URL |
| --- | --- |
| Homepage | `http://localhost:3000` |
| Setup URL (post-install callback) | `http://localhost:3000/integrations/github/setup` |
| Webhook URL | public HTTPS tunnel to the API + `/api/webhooks/github` |
| Install link used by the workspace | `http://localhost:4000/api/v1/integrations/github/install` |

There is no separate OAuth callback. GitHub redirects the browser to the Setup URL with `installation_id`. The web server then calls the API. Inside Compose that server-side call uses `http://api:4000`. The install link itself stays on `localhost` because the browser opens it.

A tunnel is still required for webhooks. Point it at the published API port (`localhost:4000`), not at the web port. Pre-install history is not reconstructed. Issues and pull requests from the first sync are snapshots of current state. Occurrences come from commits, comments, reviews, and webhook transitions after install. Inline review comments are stored as ignored until they are normalized. Collection coverage is unverified: an empty week does not mean nothing happened.

## 3. Expose webhook endpoint

GitHub cannot reach `localhost`. Use a public HTTPS tunnel to the API.

### Option A — Cloudflare Tunnel (quick)

```bash
# install once: brew install cloudflared
cloudflared tunnel --url http://localhost:4000
```

Copy the printed `https://….trycloudflare.com` URL and set the GitHub App Webhook URL to:

```text
https://YOUR-TUNNEL.trycloudflare.com/api/webhooks/github
```

### Option B — ngrok

```bash
ngrok http 4000
```

Webhook URL:

```text
https://YOUR-ID.ngrok-free.app/api/webhooks/github
```

After changing the webhook URL in GitHub App settings, use **Recent Deliveries → Redeliver** to test.

## 4. Test the real flow

1. Open `http://localhost:3000`.
2. Click **Connect GitHub**.
3. GitHub opens installation UI.
4. Select your personal account or test organization.
5. Select one repository.
6. GitHub redirects back.
7. OpenCompanyOS records the installation.
8. Repository appears in the UI; click **Save selection**.
9. Click **Start sync**.
10. Verify issues/PRs/commits appear under **Recent events** (or in Postgres `events`).
11. Open a new issue or PR in GitHub (with the tunnel running).
12. Verify a row in `webhook_deliveries` (`status=processed`) and a matching `events` row.
13. In GitHub App → Recent Deliveries, **Redeliver** the same webhook.
14. Verify delivery response is `duplicate` / no second event for the same `source_event_id`.

## 5. Important distinction

GitHub App installation = permission relationship between GitHub and OpenCompanyOS.

OpenCompanyOS user = person using your product.

Repository = resource granted to the installation.

Do not model these as one identity.
