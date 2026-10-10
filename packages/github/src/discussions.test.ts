import { describe, expect, it } from "vitest";
import {
  fetchIssueComments,
  fetchPullRequestReviews,
  type DiscussionClient,
  type GitHubPage,
} from "./discussions.js";
import { RateLimitExceeded } from "./retry.js";

function page(data: unknown[], headers: Record<string, string | undefined> = {}): GitHubPage {
  return { status: 200, headers, data };
}

describe("discussion backfill fetch", () => {
  it("stores two comment pages and skips a comment with no id", async () => {
    const comments = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: `c${index}`,
      user: { login: "ada" },
      html_url: `https://github.com/acme/repo/issues/1#issuecomment-${index}`,
      issue_url: "https://api.github.com/repos/acme/repo/issues/1",
      created_at: "2026-03-01T00:00:00Z",
      updated_at: "2026-03-02T00:00:00Z",
    }));
    const client: DiscussionClient = {
      async listIssueCommentPage(input) {
        if (input.page === 1) {
          return page(comments);
        }
        return page([
          {
            id: 101,
            body: "last",
            user: { login: "ada" },
            issue_url: "https://api.github.com/repos/acme/repo/issues/2",
            updated_at: "2026-03-03T00:00:00Z",
          },
          { body: "missing id" },
        ]);
      },
      async listReviewPage() {
        return page([]);
      },
    };

    const fetched = await fetchIssueComments(client, "acme", "repo");
    expect(fetched.skipped).toBe(1);
    expect(fetched.records).toHaveLength(101);
    expect(fetched.records[0]).toMatchObject({
      sourceEventId: "github:issue_comment:1",
      eventType: "issue_comment.backfill",
      eventTime: new Date("2026-03-02T00:00:00Z"),
      payload: { issueNumber: 1, body: "c0" },
    });
    expect(fetched.records[100]?.sourceEventId).toBe("github:issue_comment:101");
  });

  it("stores review state and body for one pull request", async () => {
    const client: DiscussionClient = {
      async listIssueCommentPage() {
        return page([]);
      },
      async listReviewPage(input) {
        expect(input.pullNumber).toBe(4);
        return page([
          {
            id: 50,
            state: "APPROVED",
            body: "ship it",
            user: { login: "ada" },
            submitted_at: "2026-03-04T00:00:00Z",
            html_url: "https://github.com/acme/repo/pull/4#pullrequestreview-50",
          },
        ]);
      },
    };
    const fetched = await fetchPullRequestReviews(client, "acme", "repo", { id: 77, number: 4 });
    expect(fetched.skipped).toBe(0);
    expect(fetched.records[0]).toMatchObject({
      sourceEventId: "github:pull_request_review:50",
      eventType: "pull_request_review.backfill",
      eventTime: new Date("2026-03-04T00:00:00Z"),
      payload: {
        state: "APPROVED",
        body: "ship it",
        pullRequestId: 77,
        pullRequestNumber: 4,
      },
    });
  });

  it("retries a review list that fails twice and then succeeds", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const client: DiscussionClient = {
      async listIssueCommentPage() {
        return page([]);
      },
      async listReviewPage() {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("unavailable") as Error & {
            status: number;
            response: { headers: Record<string, string> };
          };
          error.status = 503;
          error.response = { headers: { "retry-after": "1" } };
          throw error;
        }
        return page([{ id: 9, state: "COMMENTED", body: "ok", submitted_at: "2026-03-01T00:00:00Z" }]);
      },
    };

    const fetched = await fetchPullRequestReviews(
      client,
      "acme",
      "repo",
      { id: 1, number: 1 },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 1_000,
      },
    );
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([1_000, 1_000]);
    expect(fetched.records[0]?.payload.state).toBe("COMMENTED");
  });

  it("throws rate_limit_exceeded without sleeping past the wait cap", async () => {
    const sleeps: number[] = [];
    const client: DiscussionClient = {
      async listIssueCommentPage() {
        const error = new Error("slow") as Error & {
          status: number;
          response: { headers: Record<string, string> };
        };
        error.status = 429;
        error.response = { headers: { "retry-after": "120" } };
        throw error;
      },
      async listReviewPage() {
        return page([]);
      },
    };

    await expect(
      fetchIssueComments(client, "acme", "repo", {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 0,
      }),
    ).rejects.toBeInstanceOf(RateLimitExceeded);
    expect(sleeps.some((ms) => ms > 60_000)).toBe(false);
    expect(sleeps).toEqual([]);
  });

  it("fails when the primary quota reset is beyond the wait cap", async () => {
    const sleeps: number[] = [];
    const client: DiscussionClient = {
      async listIssueCommentPage() {
        return page([{ id: 1, body: "c", updated_at: "2026-03-01T00:00:00Z", issue_url: "https://api.github.com/repos/acme/repo/issues/1" }], {
          "x-ratelimit-remaining": "10",
          "x-ratelimit-reset": "120",
        });
      },
      async listReviewPage() {
        return page([]);
      },
    };

    await expect(
      fetchIssueComments(client, "acme", "repo", {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 0,
      }),
    ).rejects.toMatchObject({ name: "rate_limit_exceeded" });
    expect(sleeps).toEqual([]);
  });

  it("waits when the primary quota resets inside the wait cap", async () => {
    const sleeps: number[] = [];
    const client: DiscussionClient = {
      async listIssueCommentPage() {
        return page(
          [
            {
              id: 1,
              body: "c",
              updated_at: "2026-03-01T00:00:00Z",
              issue_url: "https://api.github.com/repos/acme/repo/issues/1",
            },
          ],
          {
            "x-ratelimit-remaining": "10",
            "x-ratelimit-reset": "20",
          },
        );
      },
      async listReviewPage() {
        return page([]);
      },
    };

    const fetched = await fetchIssueComments(client, "acme", "repo", {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
    });
    expect(sleeps).toEqual([20_000]);
    expect(fetched.records).toHaveLength(1);
  });
});
