export type CaseStatus = "passed" | "failed" | "skipped" | "inconclusive";

export type CaseResult = {
  id: string;
  status: CaseStatus;
  reasons: string[];
};

export type CountSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  inconclusive: number;
};

export type DatabaseStatus = "passed" | "failed" | "skipped";

export type EvalReport = {
  suite: "context-quality";
  suiteVersion: number;
  contextPackageVersion: number;
  referenceTime: string;
  runId: string | null;
  llmCalls: number;
  notes: string[];
  datasetIntegrity: CountSummary & { cases: CaseResult[] };
  contextPackage: CountSummary & { cases: CaseResult[] };
  database: {
    status: DatabaseStatus;
    source: "EVAL_DATABASE_URL" | null;
    reason: string | null;
  } & CountSummary & { cases: CaseResult[] };
  optionalLlm: {
    status: "not_run";
    llmCalls: number;
  } & CountSummary & { cases: CaseResult[] };
  unsupported: CountSummary & { cases: CaseResult[] };
  realCorpus: RealCorpusReport;
};

export type RealCorpusReport = {
  status: "not_run";
  reason: "corpus_not_imported";
  recall: null;
  precision: { status: "unscored"; reason: "verified relevant set is absent" };
  eventsNotInEvidence: null;
  temporalFailures: null;
  scopeViolations: null;
  commentReviewCoverage: null;
  subjectResolution: null;
  relationshipRetrieval: null;
  notes: string[];
};

export const REAL_CORPUS_NOT_RUN: RealCorpusReport = {
  status: "not_run",
  reason: "corpus_not_imported",
  recall: null,
  precision: {
    status: "unscored",
    reason: "verified relevant set is absent",
  },
  eventsNotInEvidence: null,
  temporalFailures: null,
  scopeViolations: null,
  commentReviewCoverage: null,
  subjectResolution: null,
  relationshipRetrieval: null,
  notes: [
    "Fixture results are separate from real-corpus retrieval.",
    "Recall uses only expected evidence whose source timestamp is inside the requested window.",
    "Absence outside that window is coverage, not a temporal-filter failure.",
    "Evidence present only in events is not counted as retrieved evidence.",
    "Precision stays unscored until a verified relevant set exists.",
    "No blended quality score is computed.",
  ],
};

export const REPORT_NOTES = [
  "Hand-authored fixture facts are the ground truth for this suite. Automatic question and fact generation from a real GitHub corpus is a later extension.",
  "Synthetic fixture results are not a measurement of real-world retrieval quality.",
  "Dataset integrity checks do not prove the Context Engine is correct.",
  "Fixture pass rate and semantic answer quality are separate and are not combined.",
  "An issue snapshot event_time is updated_at. A closure time comes only from a lifecycle occurrence, never from updated_at.",
];
