import { describe, expect, it } from "vitest";
import { subjectSnapshotEvidence } from "./subject-evidence.js";
import type { ContextState, ContextSubject } from "./types.js";

const snapshot = "github:issue:5671616833";
const when = "2026-10-02T04:34:43.000Z";

function state(eventTime: string | null, entityId = "issue-1"): ContextState {
  return {
    recordKind: "snapshot",
    entityId,
    sourceId: snapshot,
    state: "closed",
    title: "Docs: note that native OpenTelemetry works on AWS Lambda (Mangum)",
    eventTime,
    observedAt: when,
  };
}

const resolved: ContextSubject = {
  status: "resolved",
  entity: {
    id: "issue-1",
    type: "Issue",
    canonicalName: "#16451",
    sourceId: snapshot,
  },
};

describe("metadata subject snapshots", () => {
  it("cites the resolved snapshot for a recorded-title question inside the window", () => {
    const decision = subjectSnapshotEvidence({
      subject: resolved,
      states: [state(when)],
      from: new Date(when),
      to: new Date(when),
      asksForNumber: true,
    });
    expect(decision).toEqual({ mode: "snapshots", sourceIds: [snapshot] });
  });

  it("excludes a snapshot outside the requested window", () => {
    const decision = subjectSnapshotEvidence({
      subject: resolved,
      states: [state(when)],
      from: new Date("2026-10-11T00:00:00Z"),
      to: new Date("2026-10-11T00:00:00Z"),
      asksForNumber: true,
    });
    expect(decision).toEqual({ mode: "snapshots", sourceIds: [] });
  });

  it("does not invent evidence for an unknown or ambiguous number", () => {
    expect(
      subjectSnapshotEvidence({
        subject: { status: "unresolved" },
        states: [state(when)],
        from: new Date(when),
        to: new Date(when),
        asksForNumber: true,
      }),
    ).toEqual({ mode: "snapshots", sourceIds: [] });
    const issue = {
      id: "issue-1",
      type: "Issue",
      canonicalName: "#16451",
      sourceId: snapshot,
    };
    expect(
      subjectSnapshotEvidence({
        subject: { status: "ambiguous", candidates: [issue, { ...issue, id: "issue-2" }] },
        states: [state(when), state(when, "issue-2")],
        from: new Date(when),
        to: new Date(when),
        asksForNumber: true,
      }),
    ).toEqual({ mode: "snapshots", sourceIds: [] });
  });

  it("does not use a snapshot as comment, review, or issue-body evidence", () => {
    for (const evidenceKind of ["issue_comment", "pull_request_review", "issue_body"] as const) {
      expect(
        subjectSnapshotEvidence({
          evidenceKind,
          subject: resolved,
          states: [state(when)],
          from: new Date(when),
          to: new Date(when),
          asksForNumber: true,
        }),
      ).toEqual({ mode: "search" });
    }
  });
});
