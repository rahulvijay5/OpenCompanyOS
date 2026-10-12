import type { EvidenceKind } from "./evidence.js";
import type { ContextState, ContextSubject } from "./types.js";

export type SnapshotDecision =
  | { mode: "search" }
  | { mode: "snapshots"; sourceIds: string[] };

/**
 * A metadata question that names an issue or pull request cites that subject's
 * stored snapshot when the snapshot time is inside the requested window.
 * Comment, review, and body questions keep search evidence.
 * Unknown and ambiguous numbers cite nothing.
 */
export function subjectSnapshotEvidence(input: {
  evidenceKind?: EvidenceKind;
  subject: ContextSubject;
  states: readonly ContextState[];
  from: Date | null;
  to: Date | null;
  asksForNumber: boolean;
}): SnapshotDecision {
  if (input.evidenceKind || !input.asksForNumber) {
    return { mode: "search" };
  }
  if (input.subject.status !== "resolved") {
    return { mode: "snapshots", sourceIds: [] };
  }
  const entity = input.subject.entity;
  if (entity.type !== "Issue" && entity.type !== "PullRequest") {
    return { mode: "snapshots", sourceIds: [] };
  }
  const sourceIds = input.states.flatMap((state) => {
    if (state.entityId !== entity.id || !eventInWindow(state.eventTime, input.from, input.to)) {
      return [];
    }
    return [state.sourceId];
  });
  return { mode: "snapshots", sourceIds };
}

function eventInWindow(eventTime: string | null, from: Date | null, to: Date | null): boolean {
  if (!eventTime) {
    return false;
  }
  const time = new Date(eventTime).getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  if (from && time < from.getTime()) {
    return false;
  }
  if (to && time > to.getTime()) {
    return false;
  }
  return true;
}
