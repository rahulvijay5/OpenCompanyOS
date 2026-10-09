import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeGithubWebhook,
  verifyGithubWebhookSignature,
} from "./webhook.js";

describe("verifyGithubWebhookSignature", () => {
  const secret = "test-webhook-secret";
  const body = '{"action":"opened","issue":{"id":1}}';

  it("accepts a valid sha256 signature", () => {
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    expect(
      verifyGithubWebhookSignature(body, `sha256=${digest}`, secret),
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(
      verifyGithubWebhookSignature(body, "sha256=deadbeef", secret),
    ).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyGithubWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyGithubWebhookSignature(body, "sha1=abc", secret)).toBe(false);
  });

  it("accepts Buffer bodies", () => {
    const buf = Buffer.from(body, "utf8");
    const digest = createHmac("sha256", secret).update(buf).digest("hex");
    expect(
      verifyGithubWebhookSignature(buf, `sha256=${digest}`, secret),
    ).toBe(true);
  });
});

describe("normalizeGithubWebhook", () => {
  it("normalizes issues.opened to github:issue:{id}", () => {
    const events = normalizeGithubWebhook("issues", {
      action: "opened",
      issue: {
        id: 42,
        number: 3,
        title: "Hello",
        state: "open",
        html_url: "https://github.com/org/repo/issues/3",
        user: { login: "alice" },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        closed_at: null,
        body: "body",
      },
      repository: { id: 99, full_name: "org/repo" },
    });

    expect(events).toHaveLength(2);
    expect(events?.[0]?.sourceEventId).toBe("github:issue:42");
    expect(events?.[0]?.recordKind).toBe("snapshot");
    expect(events?.[1]?.sourceEventId).toBe(
      "github:issue:42:opened:2026-01-01T00:00:00Z",
    );
    expect(events?.[1]?.eventType).toBe("issues.opened");
    expect(events?.[1]?.recordKind).toBe("occurrence");
    expect(events?.[1]?.githubRepositoryId).toBe(99);
  });

  it("keeps a close as a new occurrence and refreshes the same snapshot", () => {
    const opened = normalizeGithubWebhook("issues", {
      action: "opened",
      issue: {
        id: 42,
        number: 3,
        title: "Hello",
        state: "open",
        updated_at: "2026-01-01T00:00:00Z",
      },
    });
    const closed = normalizeGithubWebhook("issues", {
      action: "closed",
      issue: {
        id: 42,
        number: 3,
        title: "Hello",
        state: "closed",
        updated_at: "2026-01-02T00:00:00Z",
      },
    });

    expect(opened?.[0]?.sourceEventId).toBe(closed?.[0]?.sourceEventId);
    expect(opened?.[1]?.sourceEventId).not.toBe(closed?.[1]?.sourceEventId);
    expect(closed?.[1]?.sourceEventId).toBe(
      "github:issue:42:closed:2026-01-02T00:00:00Z",
    );
    expect(closed?.[0]?.eventType).toBe("issues.closed");
  });

  it("returns null for unsupported event names", () => {
    expect(normalizeGithubWebhook("sponsorship", {})).toBeNull();
  });

  it("expands push commits", () => {
    const events = normalizeGithubWebhook("push", {
      ref: "refs/heads/main",
      commits: [
        {
          id: "abc123",
          message: "fix",
          timestamp: "2026-01-02T00:00:00Z",
          url: "https://github.com/org/repo/commit/abc123",
          author: { name: "Alice", username: "alice" },
        },
      ],
      repository: { id: 7 },
    });

    expect(events).toHaveLength(1);
    expect(events?.[0]?.sourceEventId).toBe("github:commit:abc123");
    expect(events?.[0]?.eventType).toBe("push.commit");
  });
});
