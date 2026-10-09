import type {
  ContextEntityRef,
  ContextEvent,
  ContextEvidence,
  ContextSubject,
} from "./types.js";

const CANDIDATE_CAP = 8;

export function loginOf(entity: ContextEntityRef): string | null {
  if (entity.sourceId?.startsWith("github:user:")) {
    const login = entity.sourceId.slice("github:user:".length);
    return login.length > 0 ? login : null;
  }
  return null;
}

export function matchExactLogin(
  query: string,
  people: readonly ContextEntityRef[],
): ContextEntityRef[] {
  const tokens = new Set(
    query.split(/[^A-Za-z0-9_-]+/).filter((token) => token.length > 0),
  );
  return people.filter((person) => {
    const login = loginOf(person);
    return login !== null && tokens.has(login);
  });
}

export function issueNumbers(query: string): number[] {
  return [
    ...new Set(
      [...query.matchAll(/#(\d+)\b/g)].map((match) => Number(match[1])),
    ),
  ];
}

export function resolveCandidates(
  matches: readonly ContextEntityRef[],
): ContextSubject {
  const unique: ContextEntityRef[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    if (seen.has(match.id)) {
      continue;
    }
    seen.add(match.id);
    unique.push(match);
  }
  if (unique.length === 1) {
    const entity = unique[0];
    if (!entity) {
      return { status: "unresolved" };
    }
    return { status: "resolved", entity };
  }
  if (unique.length > 1) {
    return { status: "ambiguous", candidates: unique.slice(0, CANDIDATE_CAP) };
  }
  return { status: "unresolved" };
}

export function selectObservedOccurrences<T extends { recordKind: string }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => row.recordKind === "occurrence");
}

export function partitionOccurrences(
  events: readonly ContextEvent[],
  from: Date | null,
  to: Date | null,
): { included: ContextEvent[]; missingTime: boolean } {
  let missingTime = false;
  const included: ContextEvent[] = [];
  for (const event of events) {
    if (!event.eventTime) {
      missingTime = true;
      continue;
    }
    const time = new Date(event.eventTime).getTime();
    if (Number.isNaN(time)) {
      missingTime = true;
      continue;
    }
    if (from && time < from.getTime()) {
      continue;
    }
    if (to && time > to.getTime()) {
      continue;
    }
    included.push(event);
  }
  return { included, missingTime };
}

export function selectCitedEvidence(
  evidence: readonly ContextEvidence[],
  evidenceIds: readonly string[],
): ContextEvidence[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const cited: ContextEvidence[] = [];
  const seen = new Set<string>();
  for (const id of evidenceIds) {
    if (seen.has(id)) {
      continue;
    }
    const row = byId.get(id);
    if (!row) {
      continue;
    }
    seen.add(id);
    cited.push(row);
  }
  return cited;
}
