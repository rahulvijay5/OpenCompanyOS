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
    source: "EVAL_DATABASE_URL" | "DATABASE_URL" | null;
    reason: string | null;
  } & CountSummary & { cases: CaseResult[] };
  optionalLlm: {
    status: "not_run";
    llmCalls: number;
  } & CountSummary & { cases: CaseResult[] };
  unsupported: CountSummary & { cases: CaseResult[] };
};

export const REPORT_NOTES = [
  "Hand-authored fixture facts are the ground truth for this suite. Automatic question and fact generation from a real GitHub corpus is a later extension.",
  "Synthetic fixture results are not a measurement of real-world retrieval quality.",
  "Dataset integrity checks do not prove the Context Engine is correct.",
  "Fixture pass rate and semantic answer quality are separate and are not combined.",
  "An issue snapshot event_time is updated_at. A closure time comes only from a lifecycle occurrence, never from updated_at.",
];
