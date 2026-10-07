# GitHub App Local Setup Checklist

## 1. Create GitHub App

Create a GitHub App in GitHub Developer Settings.

Set:
- Homepage: `http://localhost:3000`
- Setup URL: `http://localhost:3000/integrations/github/setup`
- Webhook URL: public HTTPS tunnel + `/api/webhooks/github`
- Webhook secret: generate a strong random value

Request only the read permissions needed by the MVP.

## 2. Run OpenCompanyOS

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

## 3. Expose webhook endpoint

For example:

```text
https://YOUR-TUNNEL.example/api/webhooks/github
```

forwarding to:

```text
http://localhost:4000/api/webhooks/github
```

## 4. Test the real flow

1. Open `http://localhost:3000`.
2. Click **Connect GitHub**.
3. GitHub opens installation UI.
4. Select your personal account or test organization.
5. Select one repository.
6. GitHub redirects back.
7. OpenCompanyOS records the installation.
8. Repository appears in the UI.
9. Start initial sync.
10. Verify repository/PR/issue rows in Postgres.
11. Open a new PR in GitHub.
12. Verify a webhook is received.
13. Verify one new event/PR state is persisted.
14. Redeliver the same webhook.
15. Verify no duplicate event is created.

## 5. Important distinction

GitHub App installation = permission relationship between GitHub and OpenCompanyOS.

OpenCompanyOS user = person using your product.

Repository = resource granted to the installation.

Do not model these as one identity.
