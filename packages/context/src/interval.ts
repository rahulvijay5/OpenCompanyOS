const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rolling seven-day window.
 * Boundary convention is `[start, end)`: an event at `start` is included and an event at `end` is excluded.
 * Both instants are UTC. The helper reads only the `now` argument.
 */
export type RollingSevenDayInterval = {
  timezone: "UTC";
  label: "rolling-seven-days";
  start: string;
  end: string;
};

export function rollingSevenDayInterval(now: Date): RollingSevenDayInterval {
  const endMs = now.getTime();
  if (Number.isNaN(endMs)) {
    throw new Error("invalid_now");
  }
  return {
    timezone: "UTC",
    label: "rolling-seven-days",
    start: new Date(endMs - WEEK_MS).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

/** True when `eventTime` is inside `[start, end)`. */
export function eventInRollingInterval(eventTime: Date, interval: RollingSevenDayInterval): boolean {
  const time = eventTime.getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  const start = Date.parse(interval.start);
  const end = Date.parse(interval.end);
  return time >= start && time < end;
}

/**
 * `no_relevant_evidence` means the requested kind was collected and no record supports an answer.
 * `coverage_not_collected` means the connector did not collect that kind.
 * These are not `insufficient_evidence` or `model_unavailable`.
 *
 * Sync does not persist a per-kind ingestion ledger. Coverage must be supplied by the caller.
 * A query that returns zero rows does not establish either state.
 */
export const ABSTENTION_STATES = ["no_relevant_evidence", "coverage_not_collected"] as const;

export type AbstentionState = (typeof ABSTENTION_STATES)[number];

export type IngestionCoverage =
  | { status: "collected" }
  | { status: "not_collected" }
  | { status: "untracked" };

export type AbstentionClassification =
  | { state: AbstentionState }
  | { state: "untracked_coverage" };

export function classifyAbstention(input: {
  coverage: IngestionCoverage;
  supportingRecordCount: number;
}): AbstentionClassification | null {
  if (input.coverage.status === "untracked") {
    return { state: "untracked_coverage" };
  }
  if (input.coverage.status === "not_collected") {
    return { state: "coverage_not_collected" };
  }
  if (input.supportingRecordCount === 0) {
    return { state: "no_relevant_evidence" };
  }
  return null;
}

const ROLLING_WEEK_QUERY = /\b(this week|past week|last 7 days)\b/i;
const INLINE_REVIEW_QUERY = /\binline review comments?\b/i;

export function asksRollingSevenDays(query: string): boolean {
  return ROLLING_WEEK_QUERY.test(query);
}

/**
 * Package coverage for a query.
 * Inline review comments are the only kind the connector explicitly does not normalize.
 * Every other kind stays untracked because sync has no per-kind ingestion ledger.
 * A zero-row result is not passed in as collected coverage, so this cannot return `no_relevant_evidence`.
 */
export function abstentionForQuery(query: string): AbstentionClassification {
  const coverage: IngestionCoverage = INLINE_REVIEW_QUERY.test(query)
    ? { status: "not_collected" }
    : { status: "untracked" };
  const classified = classifyAbstention({ coverage, supportingRecordCount: 0 });
  if (!classified || classified.state === "no_relevant_evidence") {
    return { state: "untracked_coverage" };
  }
  return classified;
}

export function acceptTransitionEvidence(
  fact: { eventTime: string | null; recordKind: "snapshot" | "occurrence" | null },
  interval: RollingSevenDayInterval | null,
): boolean {
  if (fact.recordKind !== "occurrence" || fact.eventTime === null) {
    return false;
  }
  if (!interval) {
    return true;
  }
  return eventInRollingInterval(new Date(fact.eventTime), interval);
}
