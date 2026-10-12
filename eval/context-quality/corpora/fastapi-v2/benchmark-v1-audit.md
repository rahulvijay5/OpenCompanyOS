# FastAPI v2 benchmark audit

This audit freezes the lexical-search result. It does not change manifests, hashes, facts, or generated questions. A perfect score on these 24 questions is not a measure of general retrieval quality.

## Frozen report

`benchmark-v1-results-lexical-v1.json` is the 13/13 report. SHA-256 `9d54917f00a184f4419877f1d1298d24ac095cf9c39a09dbf1ba08376016b3b8`. The reproduction run wrote `benchmark-v1-results-repro.json` and did not overwrite the frozen file. After the run, the frozen bytes, `benchmark-v1-results.json`, and the repro file were identical.

The earlier 11/13 pull-request report is not on disk. It was overwritten before this freeze. Those figures are remembered from the prior run (question-level 11/13, distinct-source 7/8) and are not an original artifact.

## What the 24 questions are

| Kind | Count | What a pass shows |
| --- | --- | --- |
| Issue lookup | 5 | A distinctive title token and `#number` return that issue snapshot. |
| Pull-request lookup | 4 | The same, for a pull request. |
| Title match | 4 | The token alone returns that snapshot. Subject stays unresolved. |
| State | 4 | The imported `state` matches the manifest. Retrieval is still the token lookup. |
| Merged flag | 4 | The imported `merged` flag matches the manifest. |
| Source timestamp | 3 | `event_time` equals `updatedAt`. `closedAt` and `mergedAt` stay payload metadata. |

Each window is that record's `updatedAt` on both ends. The questions do not ask for a paraphrase, a comment, a review, a relationship, or an uncertainty code.

## Boundaries

| Capability | In this benchmark |
| --- | --- |
| Metadata lookup | Yes. Titles, state, merged flag, and `updatedAt` are checked against the frozen manifest and the imported row. |
| Temporal reasoning | Only the window equal to `updatedAt`. Exclusion before `from`, after `to`, and the seven-day default are covered by separate contract tests, not by these 24 questions. |
| Semantic retrieval | No. Embeddings were not used. `config` is null. |
| Discussion retrieval | No. Comments and reviews are `not_fetched`. That is an absent collection, not zero comments. |
| Relationship reasoning | No. No expected edges are scored. |
| Uncertainty handling | No. The package still emits `no_reconstructed_history` and `inline_review_comments_unavailable`, and this benchmark does not score them. |

## Evidence that exists now

These can be checked against the frozen manifest and the 600 imported rows. They are not verified ground truth until that check is done by hand.

- Another snapshot question of the same kind as the 24, using a token that already occurs in one title.
- A `py310` query for pull request 16480. The path segment is in the imported title. The lexical split makes it match. The fact would still be the title and source id, not a new kind of evidence.
- A window-exclusion question for issue 10370 whose `to` is `2026-06-14T12:38:54Z`. Issue `github:issue:4852026509` is a real lexical match for "Roadmap" and its `updatedAt` is later. It is outside that window. It is not irrelevant, and it is not part of a verified relevant set.

## Evidence that does not exist yet

| Proposed question | Evidence required | Status |
| --- | --- | --- |
| What did a comment on one of the 20 discussion targets say? | Issue or pull-request comment body | Unverified. Text has not been fetched. |
| What review decision was recorded on one of the 10 pull requests? | Pull-request review record | Unverified. Reviews have not been fetched. |
| Which comment discusses which issue or pull request? | `DISCUSSES` edge from the backfill | Unverified. No discussion rows are imported. |
| What does the issue body say? | Issue or pull-request body | Not in the manifest. Do not invent it. |
| Which labels, base ref, or head ref does the record have? | Fields the manifest did not store | Not in the imported payload. |
| Which of several lexical hits are relevant? | A manually verified relevant set | Precision stays unscored. |
| A paraphrased question with no shared title token | Embeddings or another semantic index | Not this full-text sample. |

Questions that need discussion text stay unverified until that text is fetched and checked. Do not mark them verified from a plausible retrieval hit.

## Recall and what it does not mean

Issue question-level recall is 11/11. Distinct-source recall is 6/6. Pull-request question-level recall is 13/13. Distinct-source recall is 8/8. Precision is unscored because a verified relevant set is absent. `realCorpus` is `not_run`.

The path miss for `tutorial001` was a tokenization limit and is fixed for this query by splitting `/`, `_`, and `.` before the English parser. These limits remain, and they are not scored failures of the 24 questions:

- Query tokens shorter than 3 characters, and stop words, are dropped.
- Prefix matching can still hit a longer lexeme that starts with the token.
- Hyphenated words stay with the English parser.
- Issue and pull-request snapshots are stored as events and can appear in current state. `package.events` lists occurrences only.
- `listChanges` can add an in-window occurrence that did not match the query text.
- Evidence is capped at 8.
- The default window is seven days before `now` and has no end. These historical rows need an explicit `from` and `to`.

## Next experiment

Do not add more metadata lookups. This set is saturated. After review, pre-register comment and review questions for the planned 10 issues and 10 pull requests, and leave every one `verified: false` until an approved fetch is checked against the stored text. Do not start that fetch from this audit.
