import { describe, expect, it } from "vitest";
import { asksAboutChanges, classifyChangeKind } from "./changes.js";

describe("classifyChangeKind", () => {
  it("maps GitHub event types onto change kinds", () => {
    expect(classifyChangeKind("issues.opened")).toBe("opened");
    expect(classifyChangeKind("issues.reopened")).toBe("opened");
    expect(classifyChangeKind("issues.closed")).toBe("closed");
    expect(classifyChangeKind("pull_request.merged")).toBe("merged");
    expect(classifyChangeKind("push.commit")).toBe("pushed");
    expect(classifyChangeKind("issue_comment.created")).toBe("commented");
    expect(classifyChangeKind("pull_request_review.submitted")).toBe("reviewed");
    expect(classifyChangeKind("issues.edited")).toBe("updated");
  });
});

describe("asksAboutChanges", () => {
  it("matches change language and time phrases", () => {
    expect(asksAboutChanges("What changed in company-brain?")).toBe(true);
    expect(asksAboutChanges("issues opened today")).toBe(true);
    expect(asksAboutChanges("did rahul raise any issues?")).toBe(false);
  });
});
