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

It does not establish complete review history, inline review comments, linked issues, pre-install transitions, or why an issue was closed. A repository sync can backfill the current issue-comment and pull-request review records. Inline review comments are still ignored. The package includes `inline_review_comments_unavailable` and `no_reconstructed_history`.

`buildContext` searches GitHub `event_time` from seven days before `now` unless the caller passes `from` or `to`. That default has a start and no end. A backfilled discussion older than that week is stored and indexed, and the default window omits it. That omission is a coverage gap. An explicit `from` and `to` are inclusive. `buildContext` passes both bounds to `searchEvidence`. A direct `searchEvidence` call applies an end bound only when `until` is set. An explicit window that excludes the source timestamp is doing what it was asked, not a temporal-filter failure.

## Real corpus, not imported

`eval/context-quality/corpora/fastapi-v1/manifest.json` is a frozen prefix, not an imported tenant. Evaluation must not refetch it. `manifest.sha256` is the SHA-256 of that file's exact UTF-8 bytes, including the trailing newline. Those bytes are canonical JSON: object keys are sorted, array order is the retrieval order, and the digest is not inside the manifest. `assertManifestHash` rejects any other byte string. A later import must call it before writing rows.

The requested repository `tiangolo/fastapi` redirects to `fastapi/fastapi`, GitHub repository id `160919119`. The manifest stores both names. Issues came from `GET /repos/fastapi/fastapi/issues` and pull requests from `GET /repos/fastapi/fastapi/pulls`, both `state=all`, `sort=created`, `direction=desc`, `per_page=100`. Issue pages stopped at 8, with pagination still remaining, because that list also returns pull requests. Pull-request pages stopped at 300 records, with pagination still remaining. `updated_at` on each record is GitHub's snapshot timestamp, not a close time or a decision time.

`eval/context-quality/corpora/fastapi-v2/manifest.json` is a separate frozen artifact. Its issues are a search-selected created-descending sample from `GET /search/issues?q=repo:fastapi/fastapi+is:issue&sort=created&order=desc`, at most 3 pages of 100. That is not a random sample and not the full issue list. Its 300 pull requests are the `fastapi-v1` records in their original order and were not refetched. `fastapi-v1` is unchanged. v2 comments and reviews are `not_fetched`, its facts are empty, and its generated questions are unverified.

`comments.status` and `reviews.status` are `not_fetched`. That means those collections were not retrieved. It does not mean the repository has no comments or reviews. Inline review comments and edit history were not requested. `facts.json` has no verified facts. Every question in `generated-questions.json` is `verified: false`.

`benchmark-v1.json` is a separate 24-question sample. Its `verification.status` means only that title, state, merged flag, `updatedAt`, `closedAt`, and `mergedAt` agree between the frozen manifest and the imported events row. It does not mean the question wording was accepted as the only relevant evidence, and it does not mean retrieval returned the expected source id. Those are separate results: `expectedInEvidence` records retrieval, and no relevant set has been manually verified, so precision stays unscored. A search hit does not verify a fact. `event_time` is `updatedAt`. `closedAt` and `mergedAt` stay payload metadata. Question-level recall counts each question. Distinct-source recall counts each source id once. The sample report keeps `realCorpus.status` at `not_run`. Fixture results stay separate. Comments and reviews stay `not_fetched`.

`realCorpus.status` stays `not_run` until a verified import exists. Recall, when scored later, uses expected evidence whose source timestamp is inside the requested window and counts only `evidence` hits. Rows that appear only in `events` are separate. Precision stays unscored without a verified relevant set. Fixture pass counts are not combined with these measures.

To score these historical records without changing the default seven-day window, call `buildContext` with `from` and `to` covering the manifest `createdAt` and `updatedAt` values. Omitting those bounds leaves the production window in place, and older records stay out of the package.
