import { describe, expect, it } from "vitest";
import { resolveEvidenceKind, resolveQueryIntent } from "./intent.js";

describe("query intent", () => {
  it("reads comment and discussion questions as issue comments", () => {
    expect(
      resolveQueryIntent("What does a stored comment on issue #5833 say about response compression?"),
    ).toBe("issue_comment");
    expect(
      resolveQueryIntent("What does a stored comment on open issue #10370 say about the roadmap?"),
    ).toBe("issue_comment");
    expect(
      resolveQueryIntent(
        "What does a stored conversation comment on pull request #16465 say about SkipJsonSchema?",
      ),
    ).toBe("issue_comment");
    expect(resolveQueryIntent("What was suggested for the cache?")).toBe("issue_comment");
    expect(resolveQueryIntent("What did people discuss on issue #12?")).toBe("issue_comment");
  });

  it("reads review decisions as reviews, including an inline review comment", () => {
    expect(resolveQueryIntent("What review decision is stored for pull request #16470?")).toBe(
      "pull_request_review",
    );
    expect(resolveQueryIntent("Is a review decision stored for open pull request #16480?")).toBe(
      "pull_request_review",
    );
    expect(
      resolveQueryIntent("What does an inline review comment on pull request #16468 say about a changed line?"),
    ).toBe("pull_request_review");
  });

  it("reads an explicit issue body or description as a body request", () => {
    expect(resolveQueryIntent("Quote the issue body of #16451.")).toBe("issue_body");
    expect(resolveQueryIntent("What is the issue description of #16451?")).toBe("issue_body");
  });

  it("keeps a comment about a description as discussion", () => {
    expect(resolveQueryIntent("What does a comment say about the issue description?")).toBe(
      "issue_comment",
    );
  });

  it("leaves metadata and ambiguous wording unclassified", () => {
    expect(resolveQueryIntent("What is the recorded title of issue #16451?")).toBeUndefined();
    expect(resolveQueryIntent("mangum #16451")).toBeUndefined();
    expect(resolveQueryIntent("Is pull request #16480 merged?")).toBeUndefined();
    expect(resolveQueryIntent("who authored #16465")).toBeUndefined();
    expect(resolveQueryIntent("the suggested title of issue #1")).toBeUndefined();
    expect(resolveQueryIntent("What changed this week?")).toBeUndefined();
  });

  it("lets an explicit evidence kind override the question wording", () => {
    expect(resolveEvidenceKind("What does a stored comment say?", "pull_request_review")).toBe(
      "pull_request_review",
    );
    expect(resolveEvidenceKind("What is the title of issue #16451?", "issue_comment")).toBe(
      "issue_comment",
    );
    expect(resolveEvidenceKind("Quote the issue body of #16451.")).toBe("issue_body");
    expect(resolveEvidenceKind("mangum #16451")).toBeUndefined();
  });
});
