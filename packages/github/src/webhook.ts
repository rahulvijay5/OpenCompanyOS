import { createHmac, timingSafeEqual } from "node:crypto";

export type NormalizedWebhookEvent = {
  sourceEventId: string;
  eventType: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  /** GitHub repository id when the event is repo-scoped. */
  githubRepositoryId: number | null;
  /** When true, skip selected-repo filter (installation-level events). */
  installationScoped: boolean;
};

/**
 * Verifies `X-Hub-Signature-256` against the raw request body.
 * Returns false for missing/malformed signatures.
 */
export function verifyGithubWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const received = signatureHeader.slice("sha256=".length);
  const digest = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const receivedBuf = Buffer.from(received, "utf8");
  const digestBuf = Buffer.from(digest, "utf8");
  if (receivedBuf.length !== digestBuf.length) {
    return false;
  }

  return timingSafeEqual(receivedBuf, digestBuf);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function repoIdFromPayload(payload: Record<string, unknown>): number | null {
  const repo = asRecord(payload.repository);
  return repo ? asNumber(repo.id) : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Maps a GitHub webhook event into one or more canonical event rows.
 * Returns null for unsupported event names (caller should mark ignored).
 */
export function normalizeGithubWebhook(
  eventName: string,
  payload: Record<string, unknown>,
): NormalizedWebhookEvent[] | null {
  const action = asString(payload.action);

  switch (eventName) {
    case "issues": {
      const issue = asRecord(payload.issue);
      if (!issue || asNumber(issue.id) == null) {
        return [];
      }
      const id = asNumber(issue.id)!;
      const state = asString(issue.state) ?? "unknown";
      const eventType =
        action === "closed"
          ? "issues.closed"
          : action === "reopened"
            ? "issues.open"
            : action
              ? `issues.${action}`
              : `issues.${state}`;

      return [
        {
          sourceEventId: `github:issue:${id}`,
          eventType,
          eventTime: parseDate(issue.updated_at) ?? parseDate(issue.created_at),
          githubRepositoryId: repoIdFromPayload(payload),
          installationScoped: false,
          payload: {
            id,
            number: issue.number,
            title: issue.title,
            state: issue.state,
            htmlUrl: issue.html_url,
            userLogin: asRecord(issue.user)?.login ?? null,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            closedAt: issue.closed_at,
            body: issue.body,
            action,
          },
        },
      ];
    }

    case "pull_request": {
      const pr = asRecord(payload.pull_request);
      if (!pr || asNumber(pr.id) == null) {
        return [];
      }
      const id = asNumber(pr.id)!;
      const merged = Boolean(pr.merged_at) || action === "closed" && pr.merged === true;
      let eventType = action ? `pull_request.${action}` : `pull_request.${asString(pr.state) ?? "unknown"}`;
      if (action === "closed" && merged) {
        eventType = "pull_request.merged";
      }

      return [
        {
          sourceEventId: `github:pull_request:${id}`,
          eventType,
          eventTime: parseDate(pr.updated_at) ?? parseDate(pr.created_at),
          githubRepositoryId: repoIdFromPayload(payload),
          installationScoped: false,
          payload: {
            id,
            number: pr.number,
            title: pr.title,
            state: pr.state,
            merged,
            htmlUrl: pr.html_url,
            userLogin: asRecord(pr.user)?.login ?? null,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            closedAt: pr.closed_at,
            mergedAt: pr.merged_at,
            body: pr.body,
            action,
          },
        },
      ];
    }

    case "push": {
      const commits = Array.isArray(payload.commits) ? payload.commits : [];
      const events: NormalizedWebhookEvent[] = [];
      for (const item of commits) {
        const commit = asRecord(item);
        if (!commit) {
          continue;
        }
        const sha = asString(commit.id);
        if (!sha) {
          continue;
        }
        const author = asRecord(commit.author);
        events.push({
          sourceEventId: `github:commit:${sha}`,
          eventType: "push.commit",
          eventTime: parseDate(commit.timestamp),
          githubRepositoryId: repoIdFromPayload(payload),
          installationScoped: false,
          payload: {
            sha,
            htmlUrl: commit.url,
            message: commit.message,
            authorLogin: author?.username ?? author?.name ?? null,
            authorName: author?.name ?? null,
            committedAt: commit.timestamp,
            ref: payload.ref,
            before: payload.before,
            after: payload.after,
          },
        });
      }
      return events;
    }

    case "issue_comment": {
      const comment = asRecord(payload.comment);
      const issue = asRecord(payload.issue);
      if (!comment || asNumber(comment.id) == null) {
        return [];
      }
      const id = asNumber(comment.id)!;
      return [
        {
          sourceEventId: `github:issue_comment:${id}`,
          eventType: action
            ? `issue_comment.${action}`
            : "issue_comment.created",
          eventTime:
            parseDate(comment.updated_at) ?? parseDate(comment.created_at),
          githubRepositoryId: repoIdFromPayload(payload),
          installationScoped: false,
          payload: {
            id,
            htmlUrl: comment.html_url,
            body: comment.body,
            userLogin: asRecord(comment.user)?.login ?? null,
            issueId: issue ? asNumber(issue.id) : null,
            issueNumber: issue ? issue.number : null,
            createdAt: comment.created_at,
            updatedAt: comment.updated_at,
            action,
          },
        },
      ];
    }

    case "pull_request_review": {
      const review = asRecord(payload.review);
      const pr = asRecord(payload.pull_request);
      if (!review || asNumber(review.id) == null) {
        return [];
      }
      const id = asNumber(review.id)!;
      return [
        {
          sourceEventId: `github:pull_request_review:${id}`,
          eventType: action
            ? `pull_request_review.${action}`
            : "pull_request_review.submitted",
          eventTime: parseDate(review.submitted_at),
          githubRepositoryId: repoIdFromPayload(payload),
          installationScoped: false,
          payload: {
            id,
            htmlUrl: review.html_url,
            state: review.state,
            body: review.body,
            userLogin: asRecord(review.user)?.login ?? null,
            pullRequestId: pr ? asNumber(pr.id) : null,
            pullRequestNumber: pr ? pr.number : null,
            submittedAt: review.submitted_at,
            action,
          },
        },
      ];
    }

    case "installation":
    case "installation_repositories": {
      const installation = asRecord(payload.installation);
      const installationId = installation
        ? asNumber(installation.id)
        : null;
      const account = installation
        ? asRecord(installation.account)
        : null;
      return [
        {
          sourceEventId: `github:${eventName}:${installationId ?? "unknown"}:${action ?? "updated"}`,
          eventType: action
            ? `${eventName}.${action}`
            : `${eventName}.updated`,
          eventTime: new Date(),
          githubRepositoryId: null,
          installationScoped: true,
          payload: {
            action,
            installationId,
            accountLogin: account ? asString(account.login) : null,
            repositoriesAdded: payload.repositories_added ?? null,
            repositoriesRemoved: payload.repositories_removed ?? null,
          },
        },
      ];
    }

    default:
      return null;
  }
}
