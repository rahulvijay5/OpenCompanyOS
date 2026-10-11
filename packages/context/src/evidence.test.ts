import { describe, expect, it } from "vitest";
import { selectAnswerEvidence } from "./evidence.js";

const snapshot = { sourceId: "github:issue:5671616833" };
const comment = { sourceId: "github:issue_comment:1745618744" };
const conversation = { sourceId: "github:issue_comment:6036051915" };
const review = { sourceId: "github:pull_request_review:1" };
const pull = { sourceId: "github:pull_request:4762942697" };
const unrelatedOccurrence = { sourceId: "github:issue_comment:6058184632" };

describe("answer evidence", () => {
  it("does not append an occurrence that search did not return", () => {
    const searched = [snapshot, comment];
    expect(selectAnswerEvidence(searched).map((item) => item.sourceId)).toEqual([
      snapshot.sourceId,
      comment.sourceId,
    ]);
    expect(selectAnswerEvidence(searched).map((item) => item.sourceId)).not.toContain(
      unrelatedOccurrence.sourceId,
    );
  });

  it("drops a parent snapshot from a comment request and keeps the comment", () => {
    expect(
      selectAnswerEvidence([snapshot, comment], "issue_comment").map((item) => item.sourceId),
    ).toEqual([comment.sourceId]);
  });

  it("drops conversation comments and pull-request snapshots from a review request", () => {
    expect(
      selectAnswerEvidence([pull, conversation, review], "pull_request_review").map(
        (item) => item.sourceId,
      ),
    ).toEqual([review.sourceId]);
  });

  it("abstains from an issue-body request because no body record is eligible", () => {
    expect(selectAnswerEvidence([snapshot, comment], "issue_body")).toEqual([]);
  });

  it("still returns the snapshot for a metadata query with no evidence kind", () => {
    expect(selectAnswerEvidence([snapshot]).map((item) => item.sourceId)).toEqual([
      snapshot.sourceId,
    ]);
  });
});
