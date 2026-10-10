import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseResult, CountSummary } from "./report.js";

export const SUITE_VERSION = 1;

export type SubjectFact =
  | {
      id: string;
      kind: "subject";
      status: "resolved";
      sourceId: string;
      entityType: string;
    }
  | {
      id: string;
      kind: "subject";
      status: "ambiguous";
      sourceIds: string[];
    };

export type Fact =
  | SubjectFact
  | { id: string; kind: "subject_type_excluded"; entityType: string }
  | { id: string; kind: "scope_includes"; repositoryKey: string }
  | { id: string; kind: "scope_excludes"; repositoryKey: string }
  | { id: string; kind: "evidence_includes"; sourceId: string }
  | { id: string; kind: "evidence_excludes"; sourceId: string }
  | {
      id: string;
      kind: "relationship";
      relationshipType: string;
      source: string;
      target: string;
    }
  | { id: string; kind: "snapshot_event_time"; sourceId: string; eventTime: string }
  | { id: string; kind: "occurrence_event_time"; sourceId: string; eventTime: string }
  | { id: string; kind: "occurrence_absent"; sourceId: string }
  | {
      id: string;
      kind: "timestamps_distinct";
      snapshotFactId: string;
      transitionFactId: string;
    }
  | { id: string; kind: "uncertainty"; code: string }
  | { id: string; kind: "citation_drops_unknown"; unknownEvidenceId: string };

export type Question = {
  id: string;
  query: string;
  from?: string;
  to?: string;
  sourceId?: string;
  repositoryKeys?: string[];
  extraRepositoryIds?: string[];
  answer?: "drop_unknown_evidence";
  factIds: string[];
};

export type GeneratedQuestion = {
  id: string;
  verified: false;
  query: string;
  category: string;
};

export type FixtureRepository = {
  key: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  selected: boolean;
  githubRepositoryId: number;
  defaultBranch: string;
};

export type FixtureEvent = {
  repositoryKey: string;
  sourceEventId: string;
  eventType: string;
  eventTime: string | null;
  payload: Record<string, unknown>;
};

export type Fixtures = {
  version: number;
  repositories: FixtureRepository[];
  events: FixtureEvent[];
};

export type UnsupportedCase = {
  id: string;
  category: string;
  query: string;
};

export type Dataset = {
  version: number;
  referenceTime: string;
  facts: Fact[];
  questions: Question[];
  generatedQuestions: GeneratedQuestion[];
  fixtures: Fixtures;
  unsupported: UnsupportedCase[];
};

export function datasetDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../eval/context-quality/v1",
  );
}

export function repoRoot(): string {
  return path.resolve(datasetDir(), "../../..");
}

export async function loadDataset(): Promise<Dataset> {
  const dir = datasetDir();
  const [factsFile, questionsFile, generatedFile, fixturesFile, unsupportedFile] =
    await Promise.all([
      readJson(path.join(dir, "facts.json")),
      readJson(path.join(dir, "questions.json")),
      readJson(path.join(dir, "generated-questions.json")),
      readJson(path.join(dir, "fixtures.json")),
      readJson(path.join(dir, "unsupported.json")),
    ]);

  return {
    version: numberField(factsFile, "version"),
    referenceTime: stringField(factsFile, "referenceTime"),
    facts: Array.isArray(factsFile.facts) ? (factsFile.facts as Fact[]) : [],
    questions: Array.isArray(questionsFile.questions)
      ? (questionsFile.questions as Question[])
      : [],
    generatedQuestions: Array.isArray(generatedFile.questions)
      ? (generatedFile.questions as GeneratedQuestion[])
      : [],
    fixtures: {
      version: numberField(fixturesFile, "version"),
      repositories: Array.isArray(fixturesFile.repositories)
        ? (fixturesFile.repositories as FixtureRepository[])
        : [],
      events: Array.isArray(fixturesFile.events)
        ? (fixturesFile.events as FixtureEvent[])
        : [],
    },
    unsupported: Array.isArray(unsupportedFile.cases)
      ? (unsupportedFile.cases as UnsupportedCase[])
      : [],
  };
}

export function checkDatasetIntegrity(dataset: Dataset): CaseResult[] {
  const cases: CaseResult[] = [];
  cases.push(
    result(
      "suite-version",
      dataset.version === SUITE_VERSION &&
        dataset.fixtures.version === SUITE_VERSION,
      dataset.version === SUITE_VERSION
        ? []
        : [`dataset version is ${dataset.version}, expected ${SUITE_VERSION}`],
    ),
  );

  const factIds = new Set(dataset.facts.map((fact) => fact.id));
  const missing = dataset.questions.flatMap((question) =>
    question.factIds.filter((id) => !factIds.has(id)).map((id) => `${question.id}:${id}`),
  );
  cases.push(
    result(
      "question-fact-ids",
      missing.length === 0,
      missing.length === 0 ? [] : [`unknown fact ids: ${missing.join(", ")}`],
    ),
  );

  const verifiedGenerated = dataset.generatedQuestions.filter(
    (question) => question.verified !== false,
  );
  cases.push(
    result(
      "generated-questions-unverified",
      verifiedGenerated.length === 0,
      verifiedGenerated.length === 0
        ? []
        : [
            `generated questions must stay unverified: ${verifiedGenerated
              .map((question) => question.id)
              .join(", ")}`,
          ],
    ),
  );

  const scoredIds = new Set(dataset.questions.map((question) => question.id));
  const leaked = dataset.generatedQuestions.filter((question) => scoredIds.has(question.id));
  const generatedExcluded = leaked.length === 0 && dataset.generatedQuestions.length > 0;
  cases.push(
    result(
      "generated-questions-excluded",
      generatedExcluded,
      leaked.length > 0
        ? [
            `generated questions are in the scored set: ${leaked
              .map((question) => question.id)
              .join(", ")}`,
          ]
        : generatedExcluded
          ? []
          : ["generated question file has no questions to keep separate"],
    ),
  );

  const updated = dataset.facts.find((fact) => fact.id === "time.issue-12.updated");
  const closed = dataset.facts.find((fact) => fact.id === "time.issue-12.closed");
  const timesDiffer =
    updated?.kind === "snapshot_event_time" &&
    closed?.kind === "occurrence_event_time" &&
    Date.parse(updated.eventTime) !== Date.parse(closed.eventTime);
  cases.push(
    result(
      "updated-at-is-not-close-time",
      timesDiffer,
      timesDiffer
        ? []
        : ["snapshot updated_at and the close occurrence time must be different facts"],
    ),
  );

  const unsupportedIds = new Set(dataset.unsupported.map((item) => item.id));
  const scoredUnsupported = dataset.questions.filter((question) =>
    unsupportedIds.has(question.id),
  );
  cases.push(
    result(
      "unsupported-questions-not-scored",
      dataset.unsupported.length > 0 && scoredUnsupported.length === 0,
      scoredUnsupported.length === 0
        ? []
        : [`unsupported questions were scored: ${scoredUnsupported.map((question) => question.id).join(", ")}`],
    ),
  );

  return cases;
}

export function summarize(cases: readonly CaseResult[]): CountSummary {
  return {
    total: cases.length,
    passed: cases.filter((item) => item.status === "passed").length,
    failed: cases.filter((item) => item.status === "failed").length,
    skipped: cases.filter((item) => item.status === "skipped").length,
    inconclusive: cases.filter((item) => item.status === "inconclusive").length,
  };
}

export function result(
  id: string,
  passed: boolean,
  reasons: string[],
): CaseResult {
  return {
    id,
    status: passed ? "passed" : "failed",
    reasons: passed ? [] : reasons,
  };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid_dataset_json:${file}`);
  }
  return parsed as Record<string, unknown>;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : Number.NaN;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
