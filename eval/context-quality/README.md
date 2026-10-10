# Context quality evaluation

This suite checks assembled ContextPackage v1 results for a small hand-authored fixture. Those fixture facts are the ground truth for this milestone. Generating questions or facts from a real GitHub corpus, including `tiangolo/fastapi`, is a later extension. This command does not download or ingest that repository.

Passing fixture checks does not measure real-world retrieval quality. Dataset file checks do not prove the Context Engine is correct. Semantic judging is a separate command and is not combined with the fixture score.

An issue snapshot's `event_time` is the fixture `updated_at`. A close time is the close occurrence's own `event_time`. The suite does not treat those as the same fact.

## Commands

`pnpm test` runs the existing tests, the dataset checks, and the judge budget tests. Package-contract tests run only when `EVAL_DATABASE_URL` is set, or when `EVAL_ALLOW_APP_DATABASE=1` is set. Otherwise those tests are skipped.

`pnpm eval:context` writes `eval/context-quality/reports/latest.json`.

- Exit `0` when every context-package case passed.
- Exit `1` when dataset integrity fails, the database run fails, or a context-package case fails.
- Exit `2` when no evaluation database was available, so the package cases were skipped.

`pnpm eval` is unchanged. It checks the running API's company-brain index and does not use this suite.

`EVAL_LLM=1 EVAL_LLM_BUDGET=5 pnpm eval:context:judge` is optional. Without `EVAL_LLM=1` and a positive `EVAL_LLM_BUDGET`, it writes a report and does not call a model. Cache hits do not spend budget. The judge report does not change `facts.json`.

## Database

Set `EVAL_DATABASE_URL` to a Postgres database that is not the application database. The runner creates a tenant whose slug includes a unique run id, scores it, and deletes only that tenant and user in a `finally` block. It does not delete a tenant it did not insert.

`DATABASE_URL` is ignored unless `EVAL_ALLOW_APP_DATABASE=1`. That opt-in can read and write the application database, including rows outside this suite if a later bug is wider than the run id. Prefer `EVAL_DATABASE_URL`.

The local tenant, the company-brain index, and the product git remote are not part of this runner.

## Report sections

`latest.json` keeps separate counts for dataset integrity, context-package assertions, database status, optional LLM judging, and unsupported categories. Each section has `total`, `passed`, `failed`, `skipped`, and `inconclusive`. Unsupported categories stay inconclusive. Generated questions in `generated-questions.json` stay `verified: false` and are not scored.

## What the fixture can show

The fixture covers subject resolution, an ambiguous issue number, selected and unselected repository scope, evidence source ids, relationship endpoints, occurrence timestamps at `2026-03-15T00:00:00.000Z`, a missing event time, required uncertainty codes, and invalid evidence ids dropped by the answer path.

It does not establish complete review history, inline review comments, linked issues, pre-install transitions, or why an issue was closed. Reviews and review comments in the product are still webhook-only. The package keeps `reviews_only_from_webhooks` and `no_reconstructed_history` for that reason.
