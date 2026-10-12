import type { AbstentionClassification, RollingSevenDayInterval } from "./interval.js";

export const CONTEXT_PACKAGE_VERSION = 1 as const;

export const AUTHORIZATION_LOCAL_OWNER = "local-owner" as const;

export const UNCERTAINTY_CODES = [
  "repository_not_in_scope",
  "ambiguous_subject",
  "unresolved_subject",
  "no_reconstructed_history",
  "inline_review_comments_unavailable",
  "event_time_missing",
  "model_unavailable",
  "insufficient_evidence",
] as const;

export type UncertaintyCode = (typeof UNCERTAINTY_CODES)[number];

export const RELATIONSHIP_TYPES = [
  "AUTHORED",
  "BELONGS_TO",
  "MODIFIES",
  "DISCUSSES",
  "REVIEWED",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type ContextEntityRef = {
  id: string;
  type: string;
  canonicalName: string;
  sourceId: string | null;
};

export type ContextSubject =
  | { status: "resolved"; entity: ContextEntityRef }
  | { status: "ambiguous"; candidates: ContextEntityRef[] }
  | { status: "unresolved" };

export type ContextState = {
  recordKind: "snapshot";
  entityId: string;
  sourceId: string;
  state: string | null;
  title: string | null;
  eventTime: string | null;
  observedAt: string;
};

export type ContextEvent = {
  recordKind: "occurrence";
  id: string;
  eventType: string;
  sourceEventId: string;
  eventTime: string | null;
  observedAt: string;
  title: string | null;
  url: string | null;
};

export type ContextRelationship = {
  type: RelationshipType;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  validFrom: string | null;
};

export type EvidenceInclusionReason = "event_in_interval" | "current_snapshot" | "stored_search_hit";

export type ContextEvidence = {
  id: string;
  sourceId: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  score: number;
  repositoryId: string | null;
  /** Source event time. Null when the stored event has no event time. Ingestion time is not used. */
  eventTime: string | null;
  recordKind: "snapshot" | "occurrence" | null;
  inclusionReason: EvidenceInclusionReason;
};

export type ContextUncertainty = {
  code: UncertaintyCode;
  message: string;
};

export type ContextPackage = {
  version: typeof CONTEXT_PACKAGE_VERSION;
  scope: {
    tenantId: string;
    repositoryIds: string[];
    authorization: typeof AUTHORIZATION_LOCAL_OWNER;
  };
  subject: ContextSubject;
  currentState: ContextState[];
  events: ContextEvent[];
  relationships: ContextRelationship[];
  evidence: ContextEvidence[];
  uncertainties: ContextUncertainty[];
  /** Set for a rolling seven-day question. Null when the caller or another phrase supplies the window. */
  interval: RollingSevenDayInterval | null;
  /**
   * Ingestion knowledge for this question.
   * `no_relevant_evidence` is not emitted here: collection of a kind is not established by an empty result.
   */
  coverage: AbstentionClassification;
};

export type ContextAnswer = {
  answer: string;
  confidence: number;
  evidence: ContextEvidence[];
  uncertainties: ContextUncertainty[];
  traceId: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  context: ContextPackage;
};
