export type OccurrenceRecord = {
  eventType: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
};

/**
 * Merges two representations of one GitHub occurrence.
 * `observed_at` is applied by the caller and always becomes the ingestion time.
 */
export function mergeOccurrence(
  stored: OccurrenceRecord,
  incoming: OccurrenceRecord,
): OccurrenceRecord {
  if (stored.eventType === "issue_comment.deleted") {
    return stored;
  }

  const storedRank = specificity(stored.eventType);
  const incomingRank = specificity(incoming.eventType);
  const older = isOlder(incoming.eventTime, stored.eventTime);

  if (older && incomingRank <= storedRank) {
    return stored;
  }

  if (incoming.eventType === "issue_comment.deleted") {
    return {
      eventType: incoming.eventType,
      eventTime: older ? stored.eventTime : incoming.eventTime,
      payload: {
        ...stored.payload,
        ...incoming.payload,
        body: incoming.payload.body ?? null,
      },
    };
  }

  const eventType = incomingRank >= storedRank ? incoming.eventType : stored.eventType;
  const eventTime =
    !older && incoming.eventTime ? incoming.eventTime : (stored.eventTime ?? incoming.eventTime);

  return {
    eventType,
    eventTime,
    payload: mergePayload(stored.payload, incoming.payload),
  };
}

function specificity(eventType: string): number {
  if (eventType === "issue_comment.deleted") {
    return 3;
  }
  if (eventType.endsWith(".backfill")) {
    return 1;
  }
  return 2;
}

function isOlder(incoming: Date | null, stored: Date | null): boolean {
  if (!incoming || !stored) {
    return false;
  }
  return incoming.getTime() < stored.getTime();
}

function mergePayload(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "body" || key === "state") {
      if (present(value) || !present(stored[key])) {
        next[key] = value;
      }
      continue;
    }
    if (key === "issueId" || key === "pullRequestId" || key === "association") {
      continue;
    }
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return applyAssociation(next, stored, incoming);
}

function applyAssociation(
  next: Record<string, unknown>,
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const storedIssue = numeric(stored.issueId);
  const storedPull = numeric(stored.pullRequestId);
  if (storedIssue !== null || storedPull !== null) {
    if (storedIssue !== null) {
      next.issueId = storedIssue;
    } else {
      delete next.issueId;
    }
    if (storedPull !== null) {
      next.pullRequestId = storedPull;
    } else {
      delete next.pullRequestId;
    }
    if (stored.association === undefined) {
      delete next.association;
    } else {
      next.association = stored.association;
    }
    return next;
  }

  const incomingIssue = numeric(incoming.issueId);
  const incomingPull = numeric(incoming.pullRequestId);
  if (incomingIssue !== null) {
    next.issueId = incomingIssue;
    delete next.pullRequestId;
    delete next.association;
    return next;
  }
  if (incomingPull !== null) {
    next.pullRequestId = incomingPull;
    delete next.issueId;
    delete next.association;
    return next;
  }

  delete next.issueId;
  delete next.pullRequestId;
  next.association = "unresolved";
  return next;
}

function present(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0;
  }
  return value !== null && value !== undefined;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
