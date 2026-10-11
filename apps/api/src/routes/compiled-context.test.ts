import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectAnswerEvidence } from "@opencompanyos/context";

const require = createRequire(import.meta.url);

describe("compiled context and retrieval packages", () => {
  it("filters answer evidence in the package the API loads", () => {
    const snapshot = { sourceId: "github:issue:5671616833" };
    const comment = { sourceId: "github:issue_comment:1745618744" };
    const conversation = { sourceId: "github:issue_comment:6036051915" };
    const review = { sourceId: "github:pull_request_review:1" };
    const pull = { sourceId: "github:pull_request:4762942697" };

    expect(selectAnswerEvidence([snapshot, comment]).map((item) => item.sourceId)).toEqual([
      snapshot.sourceId,
      comment.sourceId,
    ]);
    expect(selectAnswerEvidence([snapshot, comment], "issue_comment").map((item) => item.sourceId)).toEqual([
      comment.sourceId,
    ]);
    expect(
      selectAnswerEvidence([pull, conversation, review], "pull_request_review").map(
        (item) => item.sourceId,
      ),
    ).toEqual([review.sourceId]);
    expect(selectAnswerEvidence([snapshot], "issue_body")).toEqual([]);
  });

  it("ships context assembly without merging listChanges into evidence", () => {
    const contextEntry = require.resolve("@opencompanyos/context");
    const source = readFileSync(path.join(path.dirname(contextEntry), "build.js"), "utf8");
    expect(source).not.toContain("listChanges");
    expect(source).toContain("selectAnswerEvidence");
    expect(source).toContain("resolveEvidenceKind");
    expect(source).toContain("evidenceKind");
  });

  it("ships query-time event-type filtering, separator normalization, and an end bound", () => {
    const retrievalEntry = require.resolve("@opencompanyos/retrieval");
    const source = readFileSync(path.join(path.dirname(retrievalEntry), "search.js"), "utf8");
    expect(source).toContain("SYNTHETIC_EVENT_TYPE_PATTERN");
    expect(source).toContain("LEXICAL_SEPARATORS");
    expect(source).toContain("until");
  });
});
