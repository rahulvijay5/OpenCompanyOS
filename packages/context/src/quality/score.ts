import type { LlmConfig } from "@opencompanyos/config";
import { entities, type Database } from "@opencompanyos/db";
import { eq } from "drizzle-orm";
import { answerFromPackage } from "../answer.js";
import { buildContext, type BuildContextInput } from "../build.js";
import type { ContextPackage } from "../types.js";
import type { Fact, Question } from "./dataset.js";
import type { CaseResult } from "./report.js";

const UNKNOWN_EVIDENCE_SENTINEL = "not-a-real-evidence-id";

const fakeConfig: LlmConfig = {
  baseUrl: "http://127.0.0.1:9",
  apiKey: "eval-not-used",
  chatModel: "fake",
  embeddingModel: "fake",
  embeddingDimensions: 768,
};

export type ScoredPackage = {
  questionId: string;
  package: ContextPackage;
};

export async function scoreQuestion(input: {
  db: Database;
  tenantId: string;
  userId: string;
  question: Question;
  facts: Map<string, Fact>;
  referenceTime: string;
  repositoryIds: Record<string, string>;
  sourceByEntityId: Map<string, string | null>;
}): Promise<{ result: CaseResult; scored: ScoredPackage | null }> {
  const requested = requestedRepositoryIds(input.question, input.repositoryIds);
  if ("error" in requested) {
    return {
      result: { id: input.question.id, status: "failed", reasons: [requested.error] },
      scored: null,
    };
  }

  const buildInput: BuildContextInput = {
    tenantId: input.tenantId,
    query: input.question.query,
    config: null,
    now: new Date(input.referenceTime),
  };
  if (input.question.sourceId) {
    buildInput.sourceId = input.question.sourceId;
  }
  if (input.question.from) {
    buildInput.from = new Date(input.question.from);
  }
  if (input.question.to) {
    buildInput.to = new Date(input.question.to);
  }
  if (requested.ids) {
    buildInput.repositoryIds = requested.ids;
  }

  let contextPackage: ContextPackage;
  try {
    contextPackage = await buildContext(input.db, buildInput);
  } catch (error) {
    return {
      result: {
        id: input.question.id,
        status: "failed",
        reasons: [error instanceof Error ? error.message : "buildContext failed"],
      },
      scored: null,
    };
  }

  let citedIds: string[] | null = null;
  if (input.question.answer === "drop_unknown_evidence") {
    try {
      const validId = contextPackage.evidence[0]?.id;
      const answered = await answerFromPackage(input.db, {
        tenantId: input.tenantId,
        userId: input.userId,
        query: input.question.query,
        package: contextPackage,
        config: fakeConfig,
        complete: async () => ({
          answer: "Stored evidence only.",
          confidence: 0,
          evidenceIds: validId
            ? [validId, UNKNOWN_EVIDENCE_SENTINEL]
            : [UNKNOWN_EVIDENCE_SENTINEL],
          inputTokens: 0,
          outputTokens: 0,
        }),
      });
      citedIds = answered.evidence.map((item) => item.id);
    } catch (error) {
      return {
        result: {
          id: input.question.id,
          status: "failed",
          reasons: [error instanceof Error ? error.message : "answerFromPackage failed"],
        },
        scored: { questionId: input.question.id, package: contextPackage },
      };
    }
  }

  const reasons: string[] = [];
  for (const factId of input.question.factIds) {
    const fact = input.facts.get(factId);
    if (!fact) {
      reasons.push(`missing fact ${factId}`);
      continue;
    }
    const reason = checkFact(fact, contextPackage, {
      facts: input.facts,
      repositoryIds: input.repositoryIds,
      sourceByEntityId: input.sourceByEntityId,
      citedIds,
    });
    if (reason) {
      reasons.push(reason);
    }
  }

  return {
    result: {
      id: input.question.id,
      status: reasons.length === 0 ? "passed" : "failed",
      reasons,
    },
    scored: { questionId: input.question.id, package: contextPackage },
  };
}

export async function entitySourceIds(
  db: Database,
  tenantId: string,
): Promise<Map<string, string | null>> {
  const rows = await db.query.entities.findMany({
    where: eq(entities.tenantId, tenantId),
  });
  return new Map(rows.map((row) => [row.id, row.sourceId]));
}

function requestedRepositoryIds(
  question: Question,
  repositoryIds: Record<string, string>,
): { ids?: string[] } | { error: string } {
  if (!question.repositoryKeys && !question.extraRepositoryIds) {
    return {};
  }
  const ids: string[] = [];
  for (const key of question.repositoryKeys ?? []) {
    const id = repositoryIds[key];
    if (!id) {
      return { error: `unknown repository key ${key}` };
    }
    ids.push(id);
  }
  ids.push(...(question.extraRepositoryIds ?? []));
  return { ids };
}

function checkFact(
  fact: Fact,
  contextPackage: ContextPackage,
  input: {
    facts: Map<string, Fact>;
    repositoryIds: Record<string, string>;
    sourceByEntityId: Map<string, string | null>;
    citedIds: string[] | null;
  },
): string | null {
  switch (fact.kind) {
    case "subject":
      return checkSubject(fact, contextPackage);
    case "subject_type_excluded":
      if (contextPackage.subject.status !== "resolved") {
        return "subject was not resolved";
      }
      return contextPackage.subject.entity.type === fact.entityType
        ? `subject type was ${fact.entityType}`
        : null;
    case "scope_includes":
    case "scope_excludes": {
      const repositoryId = input.repositoryIds[fact.repositoryKey];
      if (!repositoryId) {
        return `unknown repository key ${fact.repositoryKey}`;
      }
      const included = contextPackage.scope.repositoryIds.includes(repositoryId);
      if (fact.kind === "scope_includes" && !included) {
        return `${fact.repositoryKey} was outside scope`;
      }
      if (fact.kind === "scope_excludes" && included) {
        return `${fact.repositoryKey} was inside scope`;
      }
      return null;
    }
    case "evidence_includes":
      return contextPackage.evidence.some((item) => item.sourceId === fact.sourceId)
        ? null
        : `evidence missing ${fact.sourceId}`;
    case "evidence_excludes":
      return contextPackage.evidence.some((item) => item.sourceId === fact.sourceId)
        ? `evidence included ${fact.sourceId}`
        : null;
    case "relationship": {
      const matched = contextPackage.relationships.some(
        (edge) =>
          edge.type === fact.relationshipType &&
          input.sourceByEntityId.get(edge.sourceId) === fact.source &&
          input.sourceByEntityId.get(edge.targetId) === fact.target,
      );
      return matched
        ? null
        : `missing ${fact.relationshipType} ${fact.source} -> ${fact.target}`;
    }
    case "snapshot_event_time": {
      const row = contextPackage.currentState.find((item) => item.sourceId === fact.sourceId);
      if (!row) {
        return `snapshot ${fact.sourceId} was not in currentState`;
      }
      return sameTime(row.eventTime, fact.eventTime)
        ? null
        : `snapshot ${fact.sourceId} eventTime was ${row.eventTime}, expected updated_at ${fact.eventTime}`;
    }
    case "occurrence_event_time": {
      const row = contextPackage.events.find((item) => item.sourceEventId === fact.sourceId);
      if (!row) {
        return `occurrence ${fact.sourceId} was not in the time window`;
      }
      return sameTime(row.eventTime, fact.eventTime)
        ? null
        : `occurrence ${fact.sourceId} eventTime was ${row.eventTime}, expected transition ${fact.eventTime}`;
    }
    case "occurrence_absent":
      return contextPackage.events.some((item) => item.sourceEventId === fact.sourceId)
        ? `occurrence ${fact.sourceId} was included`
        : null;
    case "timestamps_distinct":
      return checkDistinctTimes(fact, contextPackage, input.facts);
    case "uncertainty":
      return contextPackage.uncertainties.some((item) => item.code === fact.code)
        ? null
        : `missing uncertainty ${fact.code}`;
    case "citation_drops_unknown": {
      if (!input.citedIds) {
        return "answer path did not run";
      }
      if (contextPackage.evidence.length === 0) {
        return "answer path had no package evidence to cite";
      }
      if (input.citedIds.includes(fact.unknownEvidenceId)) {
        return `cited unknown evidence id ${fact.unknownEvidenceId}`;
      }
      const known = new Set(contextPackage.evidence.map((item) => item.id));
      const foreign = input.citedIds.filter((id) => !known.has(id));
      if (foreign.length > 0) {
        return `cited evidence ids outside the package: ${foreign.join(", ")}`;
      }
      const expected = contextPackage.evidence[0]?.id;
      if (!expected || input.citedIds.length !== 1 || input.citedIds[0] !== expected) {
        return "answer path did not keep the one valid evidence id";
      }
      return null;
    }
    default:
      return "unsupported fact kind";
  }
}

function checkSubject(fact: SubjectFact, contextPackage: ContextPackage): string | null {
  if (fact.status === "resolved") {
    if (contextPackage.subject.status !== "resolved") {
      return `subject status was ${contextPackage.subject.status}, expected resolved ${fact.sourceId}`;
    }
    if (contextPackage.subject.entity.sourceId !== fact.sourceId) {
      return `subject source id was ${contextPackage.subject.entity.sourceId}, expected ${fact.sourceId}`;
    }
    if (contextPackage.subject.entity.type !== fact.entityType) {
      return `subject type was ${contextPackage.subject.entity.type}, expected ${fact.entityType}`;
    }
    return null;
  }

  if (contextPackage.subject.status !== "ambiguous") {
    return `subject status was ${contextPackage.subject.status}, expected ambiguous`;
  }
  const actual = contextPackage.subject.candidates
    .map((candidate) => candidate.sourceId)
    .sort();
  const expected = [...fact.sourceIds].sort();
  if (actual.join("\n") !== expected.join("\n")) {
    return `ambiguous subjects were ${actual.join(", ")}, expected ${expected.join(", ")}`;
  }
  return null;
}

function checkDistinctTimes(
  fact: Extract<Fact, { kind: "timestamps_distinct" }>,
  contextPackage: ContextPackage,
  facts: Map<string, Fact>,
): string | null {
  const snapshot = facts.get(fact.snapshotFactId);
  const transition = facts.get(fact.transitionFactId);
  if (snapshot?.kind !== "snapshot_event_time" || transition?.kind !== "occurrence_event_time") {
    return "timestamp facts are missing";
  }
  if (Date.parse(snapshot.eventTime) === Date.parse(transition.eventTime)) {
    return "ground truth uses updated_at as the close time";
  }
  const snapshotRow = contextPackage.currentState.find(
    (item) => item.sourceId === snapshot.sourceId,
  );
  const transitionRow = contextPackage.events.find(
    (item) => item.sourceEventId === transition.sourceId,
  );
  if (!snapshotRow || !transitionRow) {
    return "snapshot and close occurrence were not both present";
  }
  if (!sameTime(snapshotRow.eventTime, snapshot.eventTime)) {
    return `snapshot eventTime was ${snapshotRow.eventTime}, expected updated_at ${snapshot.eventTime}`;
  }
  if (!sameTime(transitionRow.eventTime, transition.eventTime)) {
    return `close occurrence eventTime was ${transitionRow.eventTime}, expected ${transition.eventTime}`;
  }
  if (sameTime(snapshotRow.eventTime, transition.eventTime)) {
    return "snapshot updated_at was treated as the close time";
  }
  return null;
}

function sameTime(actual: string | null, expected: string): boolean {
  if (!actual) {
    return false;
  }
  return Date.parse(actual) === Date.parse(expected);
}

type SubjectFact = Extract<Fact, { kind: "subject" }>;
