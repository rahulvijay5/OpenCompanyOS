export const CONTEXT_PACKAGE_VERSION = 1 as const;

export const AUTHORIZATION_LOCAL_OWNER = "local-owner" as const;

export const UNCERTAINTY_CODES = [
  "repository_not_in_scope",
  "ambiguous_subject",
  "unresolved_subject",
  "no_reconstructed_history",
  "reviews_only_from_webhooks",
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

export type ContextEvidence = {
  id: string;
  sourceId: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  score: number;
  repositoryId: string | null;
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
