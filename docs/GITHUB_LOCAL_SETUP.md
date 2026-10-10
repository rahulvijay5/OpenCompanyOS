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

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm --filter @opencompanyos/config build
pnpm --filter @opencompanyos/db build
pnpm --filter @opencompanyos/github build
pnpm --filter @opencompanyos/sync build
pnpm dev
```

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
