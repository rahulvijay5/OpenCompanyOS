# Discussion retrieval pre-registration

This is a specification for a later experiment. It does not fetch comments or reviews, and it does not score retrieval. Every question is `verified: false`. A parent snapshot id is not proof that a comment or review supports an answer. This set does not measure general retrieval quality.

The register is `discussion-preregistration-v1.json`. The tenant is `fastapi-v2-eeb18b73` in `opencompanyos_eval`. The parent records are already in the frozen FastAPI v2 manifest, hash `eeb18b7376c4257900435e65bd31a7c18135126d219f477eee8bfab56ac66d9d`. Comment and review source ids are unknown until a later fetch.

## Targets

Ten issues and ten pull requests. The only open issue in the frozen sample is #10370. The pull requests cover open, merged, and closed-unmerged records.

| Kind | Number | Source id | Snapshot state |
| --- | --- | --- | --- |
| Issue | 16451 | `github:issue:5671616833` | closed |
| Issue | 10370 | `github:issue:1922795955` | open |
| Issue | 15969 | `github:issue:4852026509` | closed |
| Issue | 16254 | `github:issue:5262003151` | closed |
| Issue | 16301 | `github:issue:5354821532` | closed |
| Issue | 16334 | `github:issue:5388731018` | closed |
| Issue | 16356 | `github:issue:5457243777` | closed |
| Issue | 16390 | `github:issue:5546669461` | closed |
| Issue | 16417 | `github:issue:5644286779` | closed |
| Issue | 5833 | `github:issue:1517505859` | closed |
| Pull request | 16480 | `github:pull_request:4810018525` | open, not merged |
| Pull request | 16479 | `github:pull_request:4809042528` | open, not merged |
| Pull request | 16464 | `github:pull_request:4762386092` | open, not merged |
| Pull request | 16476 | `github:pull_request:4785541113` | closed, merged |
| Pull request | 16470 | `github:pull_request:4778146414` | closed, merged |
| Pull request | 16468 | `github:pull_request:4776946757` | closed, merged |
| Pull request | 16465 | `github:pull_request:4762942697` | closed, not merged |
| Pull request | 16458 | `github:pull_request:4748094004` | closed, not merged |
| Pull request | 16454 | `github:pull_request:4725216442` | closed, not merged |
| Pull request | 16421 | `github:pull_request:4694685075` | closed, not merged |

Issue #16345, `github:issue:5423615347`, is in the frozen corpus and is not a fetch target.

## Coverage

| Evidence | Available now | Requires a later fetch |
| --- | --- | --- |
| Parent title, state, merged flag, `updatedAt` | Yes, for all 20 targets | No |
| Issue or pull-request body, labels, base ref, head ref | No | No. The planned fetch does not request them |
| Issue comment body | No. `comments.status` is `not_fetched` | Yes, for the 10 issues |
| Pull-request conversation comment body | No | Yes, for the 10 pull requests. These are issue comments on that number and must associate to the pull request |
| Pull-request review decision and review body | No. `reviews.status` is `not_fetched` | Yes, for the 10 pull requests |
| Inline review comment on a changed line | No | No. That collection is not imported |
| Comment or review on a number outside these 20 | No | No |

`not_fetched` means that collection was not retrieved. It does not mean the repository has no comments or reviews. A completed fetch that returns zero records is a different result, and a fetch that stops on 403 or 429 is a third result. Do not store either of those as an empty collection.

## Fetch limits

Each target has its own comment collection, and each pull request has its own review collection. A collection stops after 2 pages of 100 records. That limit is per collection, not a budget shared across targets.

Completeness is read from the pagination response, not from the page length alone. A collection is `complete` when the response offers no next page. That includes a finished page with zero records, and a full page of 100 when no next page is offered. If the two-page cap is reached while a next page is still offered, the collection is `incomplete_bounded`. A short page does not override a next-page link. A truncated collection is not a complete one. A completed fetch is what that endpoint returned at fetch time. It does not preserve every historical discussion event, and it does not show that deleted activity never existed.

`comments.status` and `reviews.status` keep that distinction. They stay `not_fetched` until that collection is requested. After the fetch they may be `complete` or `incomplete_bounded`. They are never rewritten to mean "no comments" or "no reviews" when the fetch was blocked or cut off.

## Empty reviews

A completed review fetch with zero records means that endpoint returned no review records for that pull request at fetch time. It does not prove that a review decision exists. It does not prove that no review-related activity ever occurred. Inline review comments are a separate collection and are not requested.

`review-pr-16480` has three outcomes:

| Outcome | What it supports |
| --- | --- |
| One or more review records returned | Those source ids can be checked. Only a person can mark which ones are relevant. |
| Completed fetch with zero records | No review source id is established. The question, as phrased, may then be an abstention. |
| Fetch incomplete or blocked, including 403, 429, or `incomplete_bounded` | The question stays `verified: false`. Do not abstain from a missing page. |

## Questions

Twelve questions cannot be answered from imported metadata. Their comment or review ids stay `null` until a person reads the stored text. Four questions are pre-registered abstentions because the required evidence is outside this experiment even after a successful fetch.

| Id | Outcome until verified | Required evidence |
| --- | --- | --- |
| `comment-issue-16451` | Unknown | Comment body on `github:issue:5671616833` |
| `comment-issue-10370` | Unknown | Comment body on `github:issue:1922795955` |
| `comment-issue-16254` | Unknown | Comment body on `github:issue:5262003151` |
| `comment-issue-16390` | Unknown | Comment body on `github:issue:5546669461` |
| `comment-issue-5833` | Unknown | Comment body on `github:issue:1517505859`. The parent snapshot is dated 2023-02-27. The scoring window is chosen after fetch and must include each relevant comment `event_time`. A 2026-only window is the wrong window. |
| `comment-pr-16480` | Unknown | Conversation comment on `github:pull_request:4810018525` |
| `comment-pr-16465` | Unknown | Conversation comment on `github:pull_request:4762942697` |
| `comment-pr-16458` | Unknown | Conversation comment on `github:pull_request:4748094004` |
| `review-pr-16470` | Unknown | Review record for `github:pull_request:4778146414` |
| `review-pr-16468` | Unknown | Review record for `github:pull_request:4776946757` |
| `review-pr-16476` | Unknown | Review record for `github:pull_request:4785541113` |
| `review-pr-16480` | Unknown until the fetch outcome is known | See "Empty reviews". Records returned, completed zero, and blocked or truncated are different. |
| `abstain-inline-review-16468` | Abstain | Inline review comment, which is not imported |
| `abstain-issue-body-16451` | Abstain | Issue body, which this fetch will not request |
| `abstain-outside-fetch-16345` | Abstain | Comment on #16345, which is outside the 20 targets |
| `abstain-title-is-not-a-comment-16451` | Abstain unless a comment body contains Mangum | The parent title contains Mangum and is not a comment |

## Relevance rubric

A stored row is relevant only when a person has read it and all of these hold:

- The question asks about a comment or a review, and the row is that kind of record.
- The row is associated with the question's target. An unresolved association is not relevant.
- The body or review state says the thing the question asks. Sharing a title word with the parent snapshot is not enough.
- The row's own `event_time` is inside the explicit window. Comment `event_time` is the comment `updated_at`. Review `event_time` is `submitted_at`. Neither is the parent snapshot `updatedAt`.

The parent snapshot is not relevant evidence for these questions. A second lexical hit on another issue or pull request is not relevant unless the rubric above fits that row. Inline review comments are not relevant because they are not stored.

Relevant is not the same as a single expected id. Several comments can each support the answer. Manual review keeps every relevant source id. Recall uses that full set. Precision uses that same set and does not drop the others to leave one id.

## Four separate scores

Do not combine these into one number, and do not score them before the labels exist.

1. Expected-source recall. After verification, the eligible set is every relevant source id whose `event_time` is inside the question's explicit window. A hit is that id in `buildContext` evidence. The parent snapshot id does not count. Before relevant ids exist, recall stays unscored. The window is chosen from the fetched timestamps. For issue #5833 it must cover 2023 comment times when those comments are relevant.
2. Precision. Score only against the manually marked relevant set for that question. Until that set exists, precision stays unscored. Do not treat unexpected hits as irrelevant without reading them.
3. Answer support. A person checks whether the retrieved text supports the claim. A matching id is not support.
4. Abstention. Correct when a completed collection has no relevant row, or the question is one of the pre-registered abstentions. A completed review fetch with zero records may support abstention for `review-pr-16480` as that question is phrased. `not_fetched` and `incomplete_bounded` do not. An answer that uses only the parent title is a failed abstention.

`realCorpus` stays `not_run` until those labels and scores are accepted. Fixture results stay separate.

## Verification procedure

1. Leave this register unchanged until the fetch is approved. Do not fill comment or review ids from guesses.
2. On approval, fetch only these 20 numbers: issue comments for each issue number, conversation comments for each pull-request number, and reviews for each of the 10 pull requests. Each collection stops after 2 pages of 100 and records whether pagination was exhausted. Do not list the whole repository. Do not request inline review comments or issue bodies.
3. Use `EVAL_DATABASE_URL` and stop unless `current_database()` is `opencompanyos_eval`. Do not write the application database.
4. If a call returns 403 or 429, stop that collection and record `not_fetched`. Do not store a failure as zero records. If page 2 is full and another page may exist, record `incomplete_bounded` and do not treat the stored prefix as the whole collection.
5. A person reads each stored body and review state and keeps every source id that supports the question. Only then may a question change from `verified: false`. A question whose collection is `not_fetched` or `incomplete_bounded` stays unverified. A question whose completed collection has no supporting text may become an abstention. A completed review fetch with zero records does not create a review source id.
6. Run `searchEvidence` and `buildContext` with `config: null` and an explicit window written for that question after the timestamps are known. Do not use the seven-day default, a 2026-only window for issue #5833, embeddings, or a model.
7. Report the four scores separately. Keep precision unscored for any question that still lacks a relevant set.

## Approval

The fetch is not authorized by this revision. Review this diff before any request is sent. Metadata questions in the existing 24-question benchmark stay as they are. The database name is `opencompanyos_eval`.
