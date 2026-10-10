export const MAX_ATTEMPTS = 3;
export const MAX_WAIT_MS = 60_000;
export const LOW_REMAINING = 50;

export class RateLimitExceeded extends Error {
  readonly status: number;
  readonly retryAt: string | null;

  constructor(status: number, retryAt: string | null, detail: string) {
    super(`rate_limit_exceeded:${status}:${detail}`);
    this.name = "rate_limit_exceeded";
    this.status = status;
    this.retryAt = retryAt;
  }
}

export class RetryableHttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string | undefined>;

  constructor(status: number, headers: Record<string, string | undefined> = {}) {
    super(`github_http_${status}`);
    this.name = "RetryableHttpError";
    this.status = status;
    this.headers = headers;
  }
}

export function waitForRetry(input: {
  status: number;
  headers: Record<string, string | undefined>;
  nowMs: number;
  remainingBudgetMs: number;
}): { waitMs: number } | { exceeded: RateLimitExceeded } {
  const retryAt = retryAtFromHeaders(input.headers, input.nowMs);
  const waitMs = retryAt === null ? 1_000 : Math.max(0, retryAt - input.nowMs);
  if (waitMs > input.remainingBudgetMs) {
    return {
      exceeded: new RateLimitExceeded(
        input.status,
        retryAt === null ? null : new Date(retryAt).toISOString(),
        `required wait ${waitMs}ms exceeds remaining budget ${input.remainingBudgetMs}ms`,
      ),
    };
  }
  return { waitMs };
}

export function waitForLowQuota(input: {
  headers: Record<string, string | undefined>;
  nowMs: number;
  remainingBudgetMs: number;
}): { waitMs: number } | { exceeded: RateLimitExceeded } | { waitMs: 0 } {
  const remaining = numberHeader(input.headers, "x-ratelimit-remaining");
  const resetSec = numberHeader(input.headers, "x-ratelimit-reset");
  if (remaining === null || remaining >= LOW_REMAINING || resetSec === null) {
    return { waitMs: 0 };
  }
  const retryAt = resetSec * 1_000;
  const waitMs = Math.max(0, retryAt - input.nowMs);
  if (waitMs === 0) {
    return { waitMs: 0 };
  }
  if (waitMs > input.remainingBudgetMs) {
    return {
      exceeded: new RateLimitExceeded(
        403,
        new Date(retryAt).toISOString(),
        `primary quota ${remaining} resets in ${waitMs}ms`,
      ),
    };
  }
  return { waitMs };
}

export async function withBoundedRetry<T>(
  operation: () => Promise<T>,
  options?: {
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    maxAttempts?: number;
    maxWaitMs?: number;
    budget?: WaitBudget;
  },
): Promise<T> {
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options?.now ?? Date.now;
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  const budget = options?.budget ?? { spentMs: 0, maxWaitMs: options?.maxWaitMs ?? MAX_WAIT_MS };
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetryableHttpError) || attempt === maxAttempts) {
        throw error;
      }
      const decision = waitForRetry({
        status: error.status,
        headers: error.headers,
        nowMs: now(),
        remainingBudgetMs: budget.maxWaitMs - budget.spentMs,
      });
      if ("exceeded" in decision) {
        throw decision.exceeded;
      }
      await sleep(decision.waitMs);
      budget.spentMs += decision.waitMs;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("retry_failed");
}

export type WaitBudget = {
  spentMs: number;
  maxWaitMs: number;
};

function retryAtFromHeaders(
  headers: Record<string, string | undefined>,
  nowMs: number,
): number | null {
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return nowMs + seconds * 1_000;
    }
    const parsed = Date.parse(retryAfter);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  const reset = numberHeader(headers, "x-ratelimit-reset");
  if (reset !== null) {
    return reset * 1_000;
  }
  return null;
}

function numberHeader(
  headers: Record<string, string | undefined>,
  name: string,
): number | null {
  const raw = headers[name];
  if (raw === undefined) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
