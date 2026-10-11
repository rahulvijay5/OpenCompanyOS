import { describe, expect, it } from "vitest";
import { scoreSuiteQuestion, type SuiteQuestion } from "./context-quality-v2-score.js";
import {
  FUSION_METHOD,
  assembleExperimentArms,
  findConstraintViolations,
  fuseCappedEvidence,
  materializeSemanticHits,
} from "./hybrid-arms.js";
import { localSemanticStatement } from "./local-semantic-search.js";

function sqlText(chunk: unknown): string {
  if (typeof chunk === "string" || typeof chunk === "number") {
    return String(chunk);
  }
  if (!chunk || typeof chunk !== "object") {
    return "";
  }
  const record = chunk as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.map(sqlText).join("");
  }
  if (Array.isArray(record.value) && record.value.every((part) => typeof part === "string")) {
    return record.value.join("");
  }
  if ("value" in record) {
    return sqlText(record.value);
  }
  return "";
}

const abstain16458: SuiteQuestion = {
  id: "v2-comment-16458",
  category: "focused_discussion",
  question: "What does a stored conversation comment on pull request #16458 say about bytearray?",
  disposition: "unanswerable",
  labelQuality: "verified_empty",
  expectedSourceIds: [],
  expectedSubjectSourceId: "github:pull_request:4748094004",
  expectedFacts: null,
  window: { from: "2026-10-05T16:44:42Z", to: "2026-10-05T17:07:33Z" },
  useDefaultWindow: false,
  verified: true,
  verificationBasis: "unit fixture",
  limitations: null,
};

describe("local semantic SQL", () => {
  it("applies scope, kind, parent, time, and EmbeddingGemma identity before the limit", () => {
    const statement = sqlText(
      localSemanticStatement({
        tenantId: "tenant-1",
        repositoryIds: ["repo-1"],
        questionId: "v2-comment-16458",
        sourceIdPrefix: "github:issue_comment:",
        subjectNumbers: [16458],
        since: new Date("2026-10-05T16:44:42Z"),
        until: new Date("2026-10-05T17:07:33Z"),
      }),
    );
    expect(statement).toContain("embeddinggemma-ollama-v1");
    expect(statement).toContain("embeddinggemma-document-v1");
    expect(statement).toContain("embeddinggemma-query-v1");
    expect(statement).toContain("16458");
    expect(statement).toContain("issueNumber");
    expect(statement).toContain("github:issue!_comment:%");
    expect(statement).toContain("event_time >=");
    expect(statement).toContain("event_time <=");
    expect(statement).toContain("repositoryId");
    expect(statement.indexOf("issueNumber")).toBeLessThan(statement.indexOf("LIMIT"));
    expect(statement.indexOf("GROUP BY")).toBeLessThan(statement.indexOf("LIMIT"));
    expect(statement).not.toContain("eval_chunk_embeddings");
    expect(statement).not.toContain("document_chunks.embedding");
  });
});

describe("capped-evidence fusion", () => {
  it("keeps an empty result empty and ignores a missing score", () => {
    expect(fuseCappedEvidence([], [])).toEqual([]);
    expect(
      fuseCappedEvidence(
        [{ documentId: "lexical-only", sourceId: "github:issue_comment:1", score: null }],
        [{ documentId: "semantic-only", sourceId: "github:issue_comment:2", score: 0.4 }],
      ).map((hit) => hit.documentId),
    ).toEqual(["semantic-only"]);
  });

  it("keeps the lexical document first when fused scores tie", () => {
    const fused = fuseCappedEvidence(
      [
        { documentId: "first", sourceId: "github:issue_comment:1", score: 1 },
        { documentId: "second", sourceId: "github:issue_comment:2", score: 1 },
      ],
      [],
    );
    expect(fused.map((hit) => hit.documentId)).toEqual(["first", "second"]);
    expect(fused[0]?.score).toBe(fused[1]?.score);
  });

  it("labels fusion and does not hide a semantic hit when lexical evidence is empty", () => {
    const arms = assembleExperimentArms({
      semanticApplies: true,
      lexical: [],
      semantic: [
        {
          documentId: "doc-branch",
          sourceId: "github:issue_comment:5998918108",
          score: 0.8,
        },
      ],
    });
    expect(arms.fusionMethod).toBe(FUSION_METHOD);
    expect(arms.A).toEqual([]);
    expect(arms.D).toEqual(["github:issue_comment:5998918108"]);
    const scored = scoreSuiteQuestion(abstain16458, {
      evidenceSourceIds: arms.D,
      subjectStatus: "resolved",
      currentStateSourceIds: ["github:pull_request:4748094004"],
      currentStateTitles: [],
      insufficientEvidence: false,
    });
    expect(scored.passed).toBe(false);
    expect(scored.failureClass).toBe("irrelevant_evidence");
  });

  it("passes the #16458 abstention only when semantic retrieval is also empty", () => {
    const arms = assembleExperimentArms({
      semanticApplies: true,
      lexical: [],
      semantic: [],
    });
    expect(arms.D).toEqual([]);
    expect(
      scoreSuiteQuestion(abstain16458, {
        evidenceSourceIds: arms.D,
        subjectStatus: "resolved",
        currentStateSourceIds: ["github:pull_request:4748094004"],
        currentStateTitles: [],
        insufficientEvidence: true,
      }).passed,
    ).toBe(true);
  });
});

describe("source id mapping and constraints", () => {
  it("keeps an unmapped document visible instead of dropping it", () => {
    const hits = materializeSemanticHits([
      { documentId: "missing-doc", sourceId: null, score: 0.5 },
    ]);
    expect(hits[0]?.sourceId).toBe("unmapped:missing-doc");
    const violations = findConstraintViolations({
      sourceIds: hits.map((hit) => hit.sourceId),
      facts: new Map(),
      sourceIdPrefix: "github:issue_comment:",
      subjectNumbers: [16458],
      from: new Date("2026-10-05T16:44:42Z"),
      to: new Date("2026-10-05T17:07:33Z"),
    });
    expect(violations).toEqual([{ sourceId: "unmapped:missing-doc", reason: "unmapped_source" }]);
  });

  it("records a wrong parent and an outside window without removing the source id", () => {
    const sourceId = "github:issue_comment:5998918108";
    const violations = findConstraintViolations({
      sourceIds: [sourceId],
      facts: new Map([
        [
          sourceId,
          {
            eventTime: "2026-10-06T00:00:00Z",
            issueNumber: "1",
            pullRequestNumber: null,
            subjectNumber: null,
          },
        ],
      ]),
      sourceIdPrefix: "github:issue_comment:",
      subjectNumbers: [16458],
      from: new Date("2026-10-05T16:44:42Z"),
      to: new Date("2026-10-05T17:07:33Z"),
    });
    expect(violations.map((item) => item.reason)).toEqual(["wrong_parent", "outside_window"]);
    expect(violations.every((item) => item.sourceId === sourceId)).toBe(true);
  });

  it("accepts a comment whose parent number matches the question", () => {
    const sourceId = "github:issue_comment:5998918108";
    expect(
      findConstraintViolations({
        sourceIds: [sourceId],
        facts: new Map([
          [
            sourceId,
            {
              eventTime: "2026-10-05T16:50:00Z",
              issueNumber: "16458",
              pullRequestNumber: null,
              subjectNumber: null,
            },
          ],
        ]),
        sourceIdPrefix: "github:issue_comment:",
        subjectNumbers: [16458],
        from: new Date("2026-10-05T16:44:42Z"),
        to: new Date("2026-10-05T17:07:33Z"),
      }),
    ).toEqual([]);
  });

  it("accepts a metadata snapshot whose own number matches the question", () => {
    const sourceId = "github:issue:5671616833";
    expect(
      findConstraintViolations({
        sourceIds: [sourceId],
        facts: new Map([
          [
            sourceId,
            {
              eventTime: "2026-10-02T04:34:43Z",
              issueNumber: null,
              pullRequestNumber: null,
              subjectNumber: "16451",
            },
          ],
        ]),
        sourceIdPrefix: null,
        subjectNumbers: [16451],
        from: null,
        to: null,
      }),
    ).toEqual([]);
  });

  it("records a subject snapshot whose number does not match", () => {
    const sourceId = "github:pull_request:4810018525";
    expect(
      findConstraintViolations({
        sourceIds: [sourceId],
        facts: new Map([
          [
            sourceId,
            {
              eventTime: "2026-10-10T08:56:58Z",
              issueNumber: null,
              pullRequestNumber: null,
              subjectNumber: "16480",
            },
          ],
        ]),
        sourceIdPrefix: null,
        subjectNumbers: [16465],
        from: null,
        to: null,
      }).map((item) => item.reason),
    ).toEqual(["wrong_parent"]);
  });

  it("records unrecognized parent metadata when no parent field exists", () => {
    const sourceId = "github:issue:1517505859";
    expect(
      findConstraintViolations({
        sourceIds: [sourceId],
        facts: new Map([
          [
            sourceId,
            {
              eventTime: "2023-01-03T15:06:48Z",
              issueNumber: null,
              pullRequestNumber: null,
              subjectNumber: null,
            },
          ],
        ]),
        sourceIdPrefix: null,
        subjectNumbers: [5833],
        from: null,
        to: null,
      }).map((item) => item.reason),
    ).toEqual(["unrecognized_parent_metadata"]);
  });
});
