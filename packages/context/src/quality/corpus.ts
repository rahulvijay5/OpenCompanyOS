export type TimeWindow = {
  from: string | null;
  to: string | null;
};

export type StoredOccurrence = {
  sourceId: string;
  eventTime: string | null;
  role: "issue_comment" | "pull_request_comment" | "review" | "other";
};

export type CorpusObservation = {
  verifiedManifest: boolean;
  window: TimeWindow;
  stored: StoredOccurrence[];
  evidenceSourceIds: string[];
  eventSourceIds: string[];
  relevantSourceIds: string[] | null;
  evidenceRepositoryIds: Array<{ sourceId: string; repositoryId: string | null }>;
  scopeRepositoryIds: string[];
  hiddenSourceIds: string[];
  subjectSourceId: string | null;
  expectedSubjectSourceId: string | null;
  relationships: Array<{ type: string; sourceId: string; targetId: string }>;
  expectedRelationships: Array<{ type: string; sourceId: string; targetId: string }>;
};

export type CorpusScore = {
  status: "not_run" | "scored";
  reason: string | null;
  recall: { hits: number; eligible: number; ratio: number | null } | null;
  precision: { status: "unscored"; reason: string } | { status: "scored"; ratio: number | null };
  eventsNotInEvidence: string[] | null;
  temporalFailures: string[] | null;
  correctlyExcluded: string[] | null;
  scopeViolations: string[] | null;
  commentReviewCoverage: {
    eligible: string[];
    inEvidence: string[];
    inEventsOnly: string[];
    missingFromBoth: string[];
  } | null;
  subjectResolution: "passed" | "failed" | "unscored" | null;
  relationshipRetrieval: { missing: string[] } | null;
};

export function isInsideWindow(eventTime: string | null, window: TimeWindow): boolean {
  if (!eventTime) {
    return false;
  }
  const time = Date.parse(eventTime);
  if (Number.isNaN(time)) {
    return false;
  }
  if (window.from && time < Date.parse(window.from)) {
    return false;
  }
  if (window.to && time > Date.parse(window.to)) {
    return false;
  }
  return true;
}

export function scoreRealCorpus(input: CorpusObservation): CorpusScore {
  if (!input.verifiedManifest) {
    return {
      status: "not_run",
      reason: "corpus_not_imported",
      recall: null,
      precision: { status: "unscored", reason: "verified relevant set is absent" },
      eventsNotInEvidence: null,
      temporalFailures: null,
      correctlyExcluded: null,
      scopeViolations: null,
      commentReviewCoverage: null,
      subjectResolution: null,
      relationshipRetrieval: null,
    };
  }

  const evidence = new Set(input.evidenceSourceIds);
  const events = new Set(input.eventSourceIds);
  const eligible = input.stored.filter((row) => isInsideWindow(row.eventTime, input.window));
  const eligibleIds = eligible.map((row) => row.sourceId);
  const hits = eligibleIds.filter((id) => evidence.has(id));
  const temporalFailures: string[] = [];
  const correctlyExcluded: string[] = [];
  for (const row of input.stored) {
    const inside = isInsideWindow(row.eventTime, input.window);
    const inEvents = events.has(row.sourceId);
    if (inside && !inEvents) {
      temporalFailures.push(`${row.sourceId} is inside the window but missing from events`);
    } else if (!inside && inEvents) {
      temporalFailures.push(`${row.sourceId} is outside the window but present in events`);
    } else if (!inside && !inEvents && !evidence.has(row.sourceId)) {
      correctlyExcluded.push(row.sourceId);
    }
  }

  const discussion = eligible.filter(
    (row) => row.role === "issue_comment" || row.role === "pull_request_comment" || row.role === "review",
  );
  const scope = new Set(input.scopeRepositoryIds);
  const hidden = new Set(input.hiddenSourceIds);
  const scopeViolations = input.evidenceRepositoryIds.flatMap((row) => {
    const reasons: string[] = [];
    if (row.repositoryId === null || !scope.has(row.repositoryId)) {
      reasons.push(`${row.sourceId} repository is outside scope`);
    }
    if (hidden.has(row.sourceId)) {
      reasons.push(`${row.sourceId} is from a hidden repository`);
    }
    return reasons;
  });
  for (const sourceId of input.eventSourceIds) {
    if (hidden.has(sourceId)) {
      scopeViolations.push(`${sourceId} event is from a hidden repository`);
    }
  }

  const expectedEdges = new Set(
    input.expectedRelationships.map((edge) => `${edge.type}:${edge.sourceId}:${edge.targetId}`),
  );
  const actualEdges = new Set(
    input.relationships.map((edge) => `${edge.type}:${edge.sourceId}:${edge.targetId}`),
  );
  const missing = [...expectedEdges].filter((edge) => !actualEdges.has(edge));

  return {
    status: "scored",
    reason: null,
    recall: {
      hits: hits.length,
      eligible: eligibleIds.length,
      ratio: eligibleIds.length === 0 ? null : hits.length / eligibleIds.length,
    },
    precision:
      input.relevantSourceIds === null
        ? { status: "unscored", reason: "verified relevant set is absent" }
        : {
            status: "scored",
            ratio:
              input.evidenceSourceIds.length === 0
                ? null
                : input.evidenceSourceIds.filter((id) => input.relevantSourceIds?.includes(id)).length /
                  input.evidenceSourceIds.length,
          },
    eventsNotInEvidence: input.eventSourceIds.filter((id) => !evidence.has(id)),
    temporalFailures,
    correctlyExcluded,
    scopeViolations,
    commentReviewCoverage: {
      eligible: discussion.map((row) => row.sourceId),
      inEvidence: discussion.filter((row) => evidence.has(row.sourceId)).map((row) => row.sourceId),
      inEventsOnly: discussion
        .filter((row) => events.has(row.sourceId) && !evidence.has(row.sourceId))
        .map((row) => row.sourceId),
      missingFromBoth: discussion
        .filter((row) => !events.has(row.sourceId) && !evidence.has(row.sourceId))
        .map((row) => row.sourceId),
    },
    subjectResolution:
      input.expectedSubjectSourceId === null
        ? "unscored"
        : input.subjectSourceId === input.expectedSubjectSourceId
          ? "passed"
          : "failed",
    relationshipRetrieval: { missing },
  };
}
