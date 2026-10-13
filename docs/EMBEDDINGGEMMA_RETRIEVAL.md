# EmbeddingGemma retrieval experiment

The demo query path is Postgres full text. This note records an offline comparison with local EmbeddingGemma. It is not the retrieval policy, and it is not a production-readiness result.

The run is `embeddinggemma-ollama-v1` in `eval/context-quality/reports/gated-semantic-fallback-v1-embeddinggemma.json`. The model name is `embeddinggemma`, served locally. The report records `hostedApiCalls: 0`. The database was `opencompanyos_eval`, tenant `fastapi-v2-eeb18b73`, with the evaluation clock fixed at `2026-10-11T00:00:00.000Z`. The gate does not use the score margin to choose rows.

## What was compared

The suite has 38 questions on a frozen FastAPI sample. Semantic search is a fallback. When lexical retrieval already returned evidence, that evidence is kept and the embedding scores are ignored. Embeddings are consulted only when the lexical list is empty. Candidates at or above a threshold are kept, at most eight.

The thresholds were registered before looking at issue #5833: 0.40, 0.50, 0.60, 0.70, and 0.80. A threshold passes only if it does all of the following:

- recover both labeled GZip comment questions, `v2-comment-5833` and `v2-comment-window-5833`
- abstain on the verified-empty questions, including `v2-comment-16458`
- keep the lexical hits that were already correct

No threshold met that bar.

## Measured results

| Threshold | Precision/recall questions | Mean recall | Mean precision | Verified-empty abstention | Joint criteria |
| --- | --- | --- | --- | --- | --- |
| 0.40 | 6/6 passed | 1.00 | 1.00 | 9/10 | Failed. Abstention on #16458 failed. |
| 0.50 | 4/6 passed | 0.67 | 1.00 | 10/10 | Failed. Both #5833 recoveries failed. |
| 0.60 | 4/6 passed | 0.67 | 1.00 | 10/10 | Failed. Both #5833 recoveries failed. |
| 0.70 | 4/6 passed | 0.67 | 1.00 | 10/10 | Failed. Both #5833 recoveries failed. |
| 0.80 | 4/6 passed | 0.67 | 1.00 | 10/10 | Failed. Both #5833 recoveries failed. |

Eight of the 38 questions stay unscored. The other scored groups (partial recall, window contract, and the unknown-identifier question) passed at every threshold. Constraint violations were zero.

Lexical retrieval, before any embedding fallback, missed both #5833 comment questions and correctly abstained on #16458.

## Why 0.40 recovered the GZip comments

`v2-comment-5833` asks what a stored comment on issue #5833 says about response compression. The verified comments are `github:issue_comment:1369875193` and `github:issue_comment:1370138075`. Their cosine scores were 0.4181 and 0.4235. Both are above 0.40 and below 0.50, so 0.40 selected exactly those two comments. Precision and recall were both 1. The same two scores and the same selection occurred for `v2-comment-window-5833`.

## Why 0.40 also returned irrelevant evidence for #16458

`v2-comment-16458` asks what a stored conversation comment on pull request #16458 says about `bytearray`. The verified relevant set is empty: the stored comments do not answer that question, so the correct result is to select nothing.

The nearest comment, `github:issue_comment:5998918108`, scored 0.4150. The other two scored 0.3667 and 0.3596. At 0.40 the gate kept the 0.4150 comment. That is irrelevant evidence. The question fails, and the joint criteria fail with it. The higher comments were the only reason this threshold looked better on the precision/recall block.

## Why a higher threshold lost the recovery

At 0.50 and above, both GZip scores fall under the threshold. The gate abstains with `below_threshold`, recall drops to 0, and both recovery questions fail. The same thresholds do abstain on #16458, because 0.4150 is below 0.50. Raising the threshold removes the bad #16458 hit by also removing the desired #5833 hits. There is no gap in this grid that keeps one and drops the other.

## Why lexical retrieval stays the policy

The product query path remains Postgres full text. This experiment does not change that. The embedding path helps only the questions lexical search already missed, and on this suite the only threshold that recovered those questions also invented support for an unanswerable pull-request question. That is the wrong trade for a demo that must say when it does not have evidence.

## Limitations

These numbers do not support a production retrieval claim.

- The set is 38 questions. Eight are unscored.
- None of the 38 asks the system to detect what changed, and none asks for the rationale of a review or merge decision. Window questions only check whether a known record sits inside a supplied interval. Review and inline-comment questions are empty-abstention cases because those records are not normalized evidence.
- The FastAPI v2 issue list is a search-selected sample, not the repository. Comment and review coverage for the frozen manifest is incomplete. A parent snapshot is not evidence that a comment answers the question.
- The run is one local model on one frozen tenant. It does not measure the company-brain demo index, webhook ingestion, or a hosted model.
