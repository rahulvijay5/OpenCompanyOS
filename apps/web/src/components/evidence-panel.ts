export type PanelEvidence = {
  id: string;
  title: string | null;
  url: string | null;
  sourceId?: string | null;
  repositoryId?: string | null;
  eventTime?: string | null;
  recordKind?: "snapshot" | "occurrence" | null;
  inclusionReason?: string | null;
};

export type PanelSnapshot = {
  sourceId: string;
  title: string | null;
  eventTime: string | null;
};

export type PanelResponse = {
  evidence: PanelEvidence[];
  uncertainties?: Array<{ code: string; message?: string }>;
  context?: {
    interval?: { timezone?: string; label?: string; start?: string; end?: string } | null;
    coverage?: { state?: string } | null;
    currentState?: PanelSnapshot[];
  } | null;
};

export type EvidenceRow = {
  id: string;
  title: string;
  href: string | null;
  eventTimeLabel: string;
  recordKindLabel: string;
  inclusionLabel: string;
  sourceLabel: string | null;
  repositoryLabel: string | null;
};

const COVERAGE_MESSAGES: Record<string, string> = {
  no_relevant_evidence: "No relevant evidence was found in the collected data for this period.",
  coverage_not_collected: "This data type was not collected, so we cannot determine what happened.",
};

const UNTRACKED_WITH_EVIDENCE = "Collection completeness has not been verified.";
const UNTRACKED_WITHOUT_EVIDENCE =
  "Collection completeness is unverified, so we cannot conclude that nothing happened.";

const UNCERTAINTY_MESSAGES: Record<string, string> = {
  insufficient_evidence: "The available evidence is not enough to support an answer.",
  model_unavailable: "Answer generation is unavailable. This does not mean the source data is missing.",
};

const INCLUSION_MESSAGES: Record<string, string> = {
  event_in_interval: "Included because its event time falls inside the retrieval interval.",
  current_snapshot: "This is the current stored snapshot, not a recorded change.",
  stored_search_hit: "Included as a stored search result.",
};

const UNKNOWN_STATE = "The response did not include a recognized explanation for this state.";

export function formatEventTime(value: string | null | undefined): string {
  if (!value) {
    return "Event time unavailable";
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return "Event time unavailable";
  }
  return new Date(time).toISOString().replace("T", " ").replace("Z", " UTC");
}

export function recordKindLabel(kind: string | null | undefined): string {
  if (kind === "occurrence") {
    return "Occurrence";
  }
  if (kind === "snapshot") {
    return "Snapshot";
  }
  return "Record kind unavailable";
}

export function inclusionLabel(reason: string | null | undefined, kind: string | null | undefined): string {
  if (kind === "snapshot") {
    return INCLUSION_MESSAGES.current_snapshot ?? UNKNOWN_STATE;
  }
  if (reason && INCLUSION_MESSAGES[reason]) {
    return INCLUSION_MESSAGES[reason];
  }
  return UNKNOWN_STATE;
}

export function coverageMessage(
  state: string | null | undefined,
  options?: { hasEvidence?: boolean },
): string {
  if (!state) {
    return UNKNOWN_STATE;
  }
  if (state === "untracked_coverage") {
    return options?.hasEvidence ? UNTRACKED_WITH_EVIDENCE : UNTRACKED_WITHOUT_EVIDENCE;
  }
  return COVERAGE_MESSAGES[state] ?? UNKNOWN_STATE;
}

export function uncertaintyMessage(code: string): string {
  return UNCERTAINTY_MESSAGES[code] ?? UNKNOWN_STATE;
}

export function intervalLabel(
  interval: { timezone?: string; label?: string; start?: string; end?: string } | null | undefined,
): string | null {
  if (!interval) {
    return null;
  }
  if (!interval.start || !interval.end) {
    return "The response included an incomplete retrieval interval.";
  }
  const rolling = interval.label === "rolling-seven-days";
  const prefix = rolling
    ? `Rolling seven days (${interval.timezone ?? "timezone unavailable"}), not a calendar week.`
    : `Retrieval interval ${interval.label ?? "unlabeled"} (${interval.timezone ?? "timezone unavailable"}).`;
  return `${prefix} Includes ${formatEventTime(interval.start)} and excludes ${formatEventTime(interval.end)}.`;
}

export function evidenceRow(item: PanelEvidence): EvidenceRow {
  return {
    id: item.id,
    title: item.title?.trim() ? item.title : "Untitled record",
    href: item.url && item.url.length > 0 ? item.url : null,
    eventTimeLabel: formatEventTime(item.eventTime),
    recordKindLabel: recordKindLabel(item.recordKind),
    inclusionLabel: inclusionLabel(item.inclusionReason, item.recordKind),
    sourceLabel: item.sourceId ? `Source ${item.sourceId}` : null,
    repositoryLabel: item.repositoryId ? `Repository ${item.repositoryId}` : null,
  };
}

export function snapshotRow(item: PanelSnapshot): EvidenceRow {
  return {
    id: item.sourceId,
    title: item.title?.trim() ? item.title : "Untitled record",
    href: null,
    eventTimeLabel: formatEventTime(item.eventTime),
    recordKindLabel: "Snapshot",
    inclusionLabel: INCLUSION_MESSAGES.current_snapshot ?? UNKNOWN_STATE,
    sourceLabel: `Source ${item.sourceId}`,
    repositoryLabel: null,
  };
}

export function resultAfterAttempt<T>(failed: boolean, next: T | null): T | null {
  if (failed) {
    return null;
  }
  return next;
}
