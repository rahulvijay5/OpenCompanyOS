import type { Octokit } from "@octokit/rest";
import {
  LOW_REMAINING,
  RateLimitExceeded,
  RetryableHttpError,
  waitForLowQuota,
  withBoundedRetry,
  type WaitBudget,
} from "./retry.js";

export type DiscussionRecord = {
  sourceEventId: string;
  eventType: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
};

export type DiscussionFetch = {
  records: DiscussionRecord[];
  skipped: number;
};

export type GitHubPage = {
  status?: number;
  headers?: Record<string, string | undefined>;
  data: unknown[];
};

export type DiscussionClient = {
  listIssueCommentPage(input: {
    owner: string;
    repo: string;
    perPage: number;
    page: number;
  }): Promise<GitHubPage>;
  listReviewPage(input: {
    owner: string;
    repo: string;
    pullNumber: number;
    perPage: number;
    page: number;
  }): Promise<GitHubPage>;
};

const PAGE_SIZE = 100;

export async function fetchIssueComments(
  client: DiscussionClient,
  owner: string,
  repo: string,
  options?: RetryOptions,
): Promise<DiscussionFetch> {
  const pages = await eachPage(
    (page) => client.listIssueCommentPage({ owner, repo, perPage: PAGE_SIZE, page }),
    options,
  );
  const records: DiscussionRecord[] = [];
  let skipped = 0;
  for (const item of pages) {
    const mapped = mapIssueComment(item);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    records.push(mapped);
  }
  return { records, skipped };
}

export async function fetchPullRequestReviews(
  client: DiscussionClient,
  owner: string,
  repo: string,
  pull: { id: number; number: number },
  options?: RetryOptions,
): Promise<DiscussionFetch> {
  if (!Number.isInteger(pull.number) || pull.number <= 0 || !Number.isInteger(pull.id)) {
    return { records: [], skipped: 1 };
  }
  const pages = await eachPage(
    (page) =>
      client.listReviewPage({
        owner,
        repo,
        pullNumber: pull.number,
        perPage: PAGE_SIZE,
        page,
      }),
    options,
  );
  const records: DiscussionRecord[] = [];
  let skipped = 0;
  for (const item of pages) {
    const mapped = mapPullRequestReview(item, pull);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    records.push(mapped);
  }
  return { records, skipped };
}

export function mapIssueComment(value: unknown): DiscussionRecord | null {
  const comment = asRecord(value);
  const id = asNumber(comment?.id);
  if (!comment || id === null) {
    return null;
  }
  const issueUrl = asString(comment.issue_url);
  const issueNumber = issueNumberFromUrl(issueUrl);
  const updatedAt = asString(comment.updated_at);
  const createdAt = asString(comment.created_at);
  return {
    sourceEventId: `github:issue_comment:${id}`,
    eventType: "issue_comment.backfill",
    eventTime: parseDate(updatedAt) ?? parseDate(createdAt),
    payload: {
      id,
      htmlUrl: asString(comment.html_url),
      body: asString(comment.body),
      userLogin: asString(asRecord(comment.user)?.login),
      issueNumber,
      issueUrl,
      createdAt,
      updatedAt,
      ...(issueNumber === null ? { association: "unresolved" } : {}),
    },
  };
}

export function mapPullRequestReview(
  value: unknown,
  pull: { id: number; number: number },
): DiscussionRecord | null {
  const review = asRecord(value);
  const id = asNumber(review?.id);
  if (!review || id === null) {
    return null;
  }
  const submittedAt = asString(review.submitted_at);
  return {
    sourceEventId: `github:pull_request_review:${id}`,
    eventType: "pull_request_review.backfill",
    eventTime: parseDate(submittedAt),
    payload: {
      id,
      htmlUrl: asString(review.html_url),
      state: asString(review.state),
      body: asString(review.body),
      userLogin: asString(asRecord(review.user)?.login),
      pullRequestId: pull.id,
      pullRequestNumber: pull.number,
      submittedAt,
    },
  };
}

export function issueNumberFromUrl(issueUrl: string | null): number | null {
  if (!issueUrl) {
    return null;
  }
  const match = /\/issues\/(\d+)$/.exec(issueUrl);
  if (!match?.[1]) {
    return null;
  }
  return Number(match[1]);
}

type RetryOptions = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxWaitMs?: number;
};

async function eachPage(
  request: (page: number) => Promise<GitHubPage>,
  options?: RetryOptions,
): Promise<unknown[]> {
  const items: unknown[] = [];
  const budget = {
    spentMs: 0,
    maxWaitMs: options?.maxWaitMs ?? 60_000,
  };
  for (let page = 1; page < 10_000; page += 1) {
    const response = await withBoundedRetry(
      async () => {
        try {
          return await request(page);
        } catch (error) {
          throw asRetryable(error);
        }
      },
      {
        ...(options?.sleep ? { sleep: options.sleep } : {}),
        ...(options?.now ? { now: options.now } : {}),
        budget,
      },
    );
    const quota = waitForLowQuota({
      headers: response.headers ?? {},
      nowMs: options?.now?.() ?? Date.now(),
      remainingBudgetMs: budget.maxWaitMs - budget.spentMs,
    });
    if ("exceeded" in quota) {
      throw quota.exceeded;
    }
    if (quota.waitMs > 0) {
      await (options?.sleep ?? defaultSleep)(quota.waitMs);
      budget.spentMs += quota.waitMs;
    }
    items.push(...response.data);
    if (response.data.length < PAGE_SIZE) {
      break;
    }
  }
  return items;
}

function asRetryable(error: unknown): unknown {
  if (error instanceof RateLimitExceeded || error instanceof RetryableHttpError) {
    return error;
  }
  const status = statusOf(error);
  if (status === null) {
    return error;
  }
  const headers = headersOf(error);
  const remaining = headers["x-ratelimit-remaining"];
  if (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (status === 403 && remaining === "0")
  ) {
    return new RetryableHttpError(status, headers);
  }
  return error;
}

function statusOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number(error.status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

function headersOf(error: unknown): Record<string, string | undefined> {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return {};
  }
  const response = error.response;
  if (typeof response !== "object" || response === null || !("headers" in response)) {
    return {};
  }
  const headers = response.headers;
  if (typeof headers !== "object" || headers === null) {
    return {};
  }
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" || typeof value === "number") {
      record[key.toLowerCase()] = String(value);
    }
  }
  return record;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function discussionClientFromOctokit(octokit: Octokit): DiscussionClient {
  return {
    async listIssueCommentPage(input) {
      const response = await octokit.rest.issues.listCommentsForRepo({
        owner: input.owner,
        repo: input.repo,
        per_page: input.perPage,
        page: input.page,
      });
      return {
        status: response.status,
        headers: headerRecord(response.headers),
        data: response.data,
      };
    },
    async listReviewPage(input) {
      const response = await octokit.rest.pulls.listReviews({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        per_page: input.perPage,
        page: input.page,
      });
      return {
        status: response.status,
        headers: headerRecord(response.headers),
        data: response.data,
      };
    },
  };
}

function headerRecord(headers: { [key: string]: unknown }): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" || typeof value === "number") {
      record[key.toLowerCase()] = String(value);
    }
  }
  return record;
}

export { LOW_REMAINING, RateLimitExceeded, type WaitBudget };
