# Context quality evaluation

This suite checks assembled ContextPackage v1 results for a small hand-authored fixture. Those fixture facts are the ground truth for this milestone. Generating questions or facts from a real GitHub corpus, including `tiangolo/fastapi`, is a later extension. This command does not download or ingest that repository.

Passing fixture checks does not measure real-world retrieval quality. Dataset file checks do not prove the Context Engine is correct. Semantic judging is a separate command and is not combined with the fixture score.

An issue snapshot's `event_time` is the fixture `updated_at`. A close time is the close occurrence's own `event_time`. The suite does not treat those as the same fact.

## Commands

`pnpm test` runs the existing tests, the dataset checks, and the judge budget tests. Package-contract tests and other tests that create tenants run only when `EVAL_DATABASE_URL` is set. They do not fall back to `DATABASE_URL`.

`pnpm eval:context` writes one report per run at `eval/context-quality/reports/{runId}.json`. `latest.json` is only a pointer to that file: `runId`, `path`, and `suiteVersion`. The score is not copied into `latest.json`.

- Exit `0` when every context-package case passed.
- Exit `1` when dataset integrity fails, the database run fails, or a context-package case fails.
- Exit `2` when no evaluation database was available, so the package cases were skipped.

`pnpm eval` is unchanged. It checks the running API's company-brain index and does not use this suite.

`EVAL_LLM=1 EVAL_LLM_BUDGET=5 pnpm eval:context:judge` is optional. Without `EVAL_LLM=1` and a positive `EVAL_LLM_BUDGET`, it writes a report and does not call a model. Cache hits do not spend budget. The judge report does not change `facts.json`.

## Database

Set `EVAL_DATABASE_URL` to a Postgres database that is not the application database. The runner creates a tenant whose slug includes a unique run id, scores it, and deletes only that tenant and user in a `finally` block. It does not delete a tenant it did not insert.

`DATABASE_URL` is not read for this suite.

The local tenant, the company-brain index, and the product git remote are not part of this runner.

## Report sections

`latest.json` points at the newest per-run report. That report keeps separate counts for dataset integrity, context-package assertions, database status, optional LLM judging, and unsupported categories. Each section has `total`, `passed`, `failed`, `skipped`, and `inconclusive`. Unsupported categories stay inconclusive. Generated questions in `generated-questions.json` stay `verified: false` and are not scored.

## What the fixture can show

The fixture covers subject resolution, an ambiguous issue number, selected and unselected repository scope, evidence source ids, relationship endpoints, occurrence timestamps at `2026-03-15T00:00:00.000Z`, a missing event time, required uncertainty codes, and invalid evidence ids dropped by the answer path.

It does not establish complete review history, inline review comments, linked issues, pre-install transitions, or why an issue was closed. A repository sync can backfill the current issue-comment and pull-request review records. Inline review comments are still ignored. The package still includes `reviews_only_from_webhooks` and `no_reconstructed_history`.
