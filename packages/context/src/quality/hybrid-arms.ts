import { fuseHits } from "@opencompanyos/retrieval";

/** Arm C fuses Arm A's already capped evidence with semantic hits. It does not see the uncapped lexical ranking. */
export const FUSION_METHOD = "capped-evidence fusion" as const;

export type ScoredSource = {
  documentId: string;
  sourceId: string;
  score: number | null;
};

export type SemanticHit = {
  documentId: string;
  sourceId: string | null;
  score: number;
};

export type ExperimentArms = {
  fusionMethod: typeof FUSION_METHOD | "not-applied";
  A: string[];
  B: string[];
  C: string[];
  D: string[];
};

const ARM_CAP = 8;

export function materializeSemanticHits(rows: readonly SemanticHit[]): ScoredSource[] {
  return rows.map((row) => ({
    documentId: row.documentId,
    sourceId:
      row.sourceId && row.sourceId.length > 0 ? row.sourceId : `unmapped:${row.documentId}`,
    score: row.score,
  }));
}

function finiteHits(hits: readonly ScoredSource[]): { documentId: string; score: number }[] {
  return hits.flatMap((hit) =>
    hit.score === null || !Number.isFinite(hit.score)
      ? []
      : [{ documentId: hit.documentId, score: hit.score }],
  );
}

export function fuseCappedEvidence(
  lexical: readonly ScoredSource[],
  semantic: readonly ScoredSource[],
): { documentId: string; score: number }[] {
  return fuseHits(finiteHits(lexical), finiteHits(semantic));
}

function sourceByDocument(hits: readonly ScoredSource[]): Map<string, string> {
  return new Map(hits.map((hit) => [hit.documentId, hit.sourceId]));
}

export function assembleExperimentArms(input: {
  semanticApplies: boolean;
  lexical: readonly ScoredSource[];
  semantic: readonly SemanticHit[];
}): ExperimentArms {
  const lexicalIds = input.lexical.map((hit) => hit.sourceId);
  if (!input.semanticApplies) {
    return {
      fusionMethod: "not-applied",
      A: lexicalIds,
      B: lexicalIds,
      C: lexicalIds,
      D: lexicalIds,
    };
  }
  const semanticHits = materializeSemanticHits(input.semantic).slice(0, ARM_CAP);
  const semanticIds = semanticHits.map((hit) => hit.sourceId);
  const fused = fuseCappedEvidence(input.lexical, materializeSemanticHits(input.semantic)).slice(
    0,
    ARM_CAP,
  );
  const sources = sourceByDocument([
    ...input.lexical,
    ...materializeSemanticHits(input.semantic),
  ]);
  const fusedIds = fused.map(
    (hit) => sources.get(hit.documentId) ?? `unmapped:${hit.documentId}`,
  );
  return {
    fusionMethod: FUSION_METHOD,
    A: lexicalIds,
    B: semanticIds,
    C: fusedIds,
    D: lexicalIds.length > 0 ? lexicalIds : semanticIds,
  };
}

export type EvidenceFact = {
  eventTime: string | null;
  issueNumber: string | null;
  pullRequestNumber: string | null;
  subjectNumber: string | null;
};

export type ConstraintViolation = {
  sourceId: string;
  reason:
    | "wrong_parent"
    | "unrecognized_parent_metadata"
    | "outside_window"
    | "missing_event_time"
    | "wrong_kind"
    | "unmapped_source";
};

function presentNumber(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

/** Comment parents use issueNumber or pullRequestNumber. Subject snapshots use payload number. */
export function parentConstraintReason(
  fact: EvidenceFact,
  subjectNumbers: ReadonlySet<string>,
): "wrong_parent" | "unrecognized_parent_metadata" | null {
  const parent = presentNumber(fact.issueNumber) ?? presentNumber(fact.pullRequestNumber);
  if (parent !== null) {
    return subjectNumbers.has(parent) ? null : "wrong_parent";
  }
  const subjectNumber = presentNumber(fact.subjectNumber);
  if (subjectNumber !== null) {
    return subjectNumbers.has(subjectNumber) ? null : "wrong_parent";
  }
  return "unrecognized_parent_metadata";
}

export function findConstraintViolations(input: {
  sourceIds: readonly string[];
  facts: ReadonlyMap<string, EvidenceFact>;
  sourceIdPrefix: string | null;
  subjectNumbers: readonly number[];
  from: Date | null;
  to: Date | null;
}): ConstraintViolation[] {
  const numbers = new Set(input.subjectNumbers.map(String));
  const violations: ConstraintViolation[] = [];
  for (const sourceId of input.sourceIds) {
    if (sourceId.startsWith("unmapped:")) {
      violations.push({ sourceId, reason: "unmapped_source" });
      continue;
    }
    if (input.sourceIdPrefix && !sourceId.startsWith(input.sourceIdPrefix)) {
      violations.push({ sourceId, reason: "wrong_kind" });
    }
    const fact = input.facts.get(sourceId);
    if (!fact) {
      continue;
    }
    if (numbers.size > 0) {
      const reason = parentConstraintReason(fact, numbers);
      if (reason) {
        violations.push({ sourceId, reason });
      }
    }
    if (!fact.eventTime) {
      violations.push({ sourceId, reason: "missing_event_time" });
      continue;
    }
    const time = new Date(fact.eventTime).getTime();
    if (Number.isNaN(time)) {
      violations.push({ sourceId, reason: "missing_event_time" });
      continue;
    }
    if (
      (input.from && time < input.from.getTime()) ||
      (input.to && time > input.to.getTime())
    ) {
      violations.push({ sourceId, reason: "outside_window" });
    }
  }
  return violations;
}
