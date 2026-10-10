import { describe, expect, it } from "vitest";
import { mergeOccurrence } from "./merge.js";

const earlier = new Date("2026-03-01T00:00:00.000Z");
const later = new Date("2026-03-02T00:00:00.000Z");

describe("mergeOccurrence", () => {
  it("lets a newer webhook replace a backfill", () => {
    const merged = mergeOccurrence(
      {
        eventType: "issue_comment.backfill",
        eventTime: earlier,
        payload: { body: "old", association: "unresolved", issueNumber: 4 },
      },
      {
        eventType: "issue_comment.edited",
        eventTime: later,
        payload: { body: "edited", issueId: 12, issueNumber: 4 },
      },
    );
    expect(merged.eventType).toBe("issue_comment.edited");
    expect(merged.eventTime).toEqual(later);
    expect(merged.payload.body).toBe("edited");
    expect(merged.payload.issueId).toBe(12);
    expect(merged.payload.association).toBeUndefined();
  });

  it("keeps a webhook when an older backfill arrives later", () => {
    const merged = mergeOccurrence(
      {
        eventType: "issue_comment.edited",
        eventTime: later,
        payload: { body: "edited", state: "approved", issueId: 12 },
      },
      {
        eventType: "issue_comment.backfill",
        eventTime: earlier,
        payload: { body: "", state: "", association: "unresolved" },
      },
    );
    expect(merged.eventType).toBe("issue_comment.edited");
    expect(merged.payload.body).toBe("edited");
    expect(merged.payload.state).toBe("approved");
    expect(merged.payload.issueId).toBe(12);
    expect(merged.payload.association).toBeUndefined();
  });

  it("keeps a deleted comment terminal", () => {
    const merged = mergeOccurrence(
      {
        eventType: "issue_comment.deleted",
        eventTime: earlier,
        payload: { body: null },
      },
      {
        eventType: "issue_comment.backfill",
        eventTime: later,
        payload: { body: "restored" },
      },
    );
    expect(merged.eventType).toBe("issue_comment.deleted");
    expect(merged.payload.body).toBeNull();
  });

  it("lets a newer backfill refresh a body without replacing the webhook type", () => {
    const merged = mergeOccurrence(
      {
        eventType: "pull_request_review.submitted",
        eventTime: earlier,
        payload: { body: "first", state: "approved", pullRequestId: 5 },
      },
      {
        eventType: "pull_request_review.backfill",
        eventTime: later,
        payload: { body: "updated", state: "", association: "unresolved" },
      },
    );
    expect(merged.eventType).toBe("pull_request_review.submitted");
    expect(merged.eventTime).toEqual(later);
    expect(merged.payload.body).toBe("updated");
    expect(merged.payload.state).toBe("approved");
    expect(merged.payload.pullRequestId).toBe(5);
  });
});
