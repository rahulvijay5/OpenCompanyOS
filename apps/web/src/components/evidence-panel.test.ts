import { describe, expect, it } from "vitest";
import {
  coverageMessage,
  evidenceRow,
  intervalLabel,
  resultAfterAttempt,
  snapshotRow,
  uncertaintyMessage,
  type PanelResponse,
} from "./evidence-panel";

const interval = {
  timezone: "UTC",
  label: "rolling-seven-days",
  start: "2026-10-04T15:30:00.000Z",
  end: "2026-10-11T15:30:00.000Z",
};

describe("evidence rows", () => {
  it("formats a stored event time and a clickable source URL", () => {
    const row = evidenceRow({
      id: "e1",
      title: "Skip JSON schema",
      url: "https://github.com/fastapi/fastapi/pull/16465#issuecomment-1",
      sourceId: "github:issue_comment:6036051915",
      repositoryId: "repo-1",
      eventTime: "2026-10-07T10:30:20.000Z",
      recordKind: "occurrence",
      inclusionReason: "event_in_interval",
    });
    expect(row.href).toBe("https://github.com/fastapi/fastapi/pull/16465#issuecomment-1");
    expect(row.eventTimeLabel).toBe("2026-10-07 10:30:20.000 UTC");
    expect(row.recordKindLabel).toBe("Occurrence");
    expect(row.sourceLabel).toBe("Source github:issue_comment:6036051915");
    expect(row.repositoryLabel).toBe("Repository repo-1");
  });

  it("does not invent an event time when the source has none", () => {
    const row = evidenceRow({
      id: "e2",
      title: "Untitled comment",
      url: null,
      eventTime: null,
      recordKind: "occurrence",
      inclusionReason: "event_in_interval",
    });
    expect(row.href).toBeNull();
    expect(row.eventTimeLabel).toBe("Event time unavailable");
  });

  it("labels a snapshot as current state rather than a change", () => {
    const row = snapshotRow({
      sourceId: "github:issue:5671616833",
      title: "Docs: OpenTelemetry",
      eventTime: "2026-10-02T04:34:43.000Z",
    });
    expect(row.recordKindLabel).toBe("Snapshot");
    expect(row.inclusionLabel).toContain("not a recorded change");
    expect(row.href).toBeNull();
  });
});

describe("coverage and uncertainty copy", () => {
  it("uses the API coverage and uncertainty states without collapsing them", () => {
    expect(coverageMessage("no_relevant_evidence")).toContain("No relevant evidence was found");
    expect(coverageMessage("coverage_not_collected")).toContain("was not collected");
    expect(coverageMessage("untracked_coverage", { hasEvidence: false })).toContain(
      "cannot conclude that nothing happened",
    );
    expect(coverageMessage("untracked_coverage", { hasEvidence: true })).toBe(
      "Collection completeness has not been verified.",
    );
    expect(coverageMessage("untracked_coverage", { hasEvidence: true })).not.toContain(
      "nothing happened",
    );
    expect(uncertaintyMessage("insufficient_evidence")).toContain("not enough to support an answer");
    expect(uncertaintyMessage("model_unavailable")).toContain("does not mean the source data is missing");
    expect(coverageMessage("something_else")).toContain("recognized explanation");
  });

  it("describes the rolling UTC interval from the response", () => {
    expect(intervalLabel(interval)).toContain("not a calendar week");
    expect(intervalLabel(interval)).toContain("2026-10-04 15:30:00.000 UTC");
    expect(intervalLabel(interval)).toContain("2026-10-11 15:30:00.000 UTC");
  });
});

describe("panel result replacement", () => {
  it("drops the previous result when the query fails", () => {
    const previous: PanelResponse = {
      evidence: [{ id: "old", title: "Old", url: "https://example.com", eventTime: "2026-10-05T00:00:00.000Z" }],
    };
    expect(resultAfterAttempt(true, previous)).toBeNull();
  });

  it("keeps an empty evidence list with untracked coverage", () => {
    const next: PanelResponse = {
      evidence: [],
      context: { interval, coverage: { state: "untracked_coverage" }, currentState: [] },
    };
    expect(resultAfterAttempt(false, next)?.evidence).toEqual([]);
    expect(coverageMessage(next.context?.coverage?.state, { hasEvidence: false })).toContain(
      "cannot conclude that nothing happened",
    );
    expect(intervalLabel(next.context?.interval)).toContain("Rolling seven days");
  });

  it("keeps untracked coverage non-alarmist when evidence is present", () => {
    const next: PanelResponse = {
      evidence: [
        {
          id: "e1",
          title: "Skip JSON schema",
          url: "https://github.com/fastapi/fastapi/pull/16465",
          eventTime: "2026-10-07T10:30:20.000Z",
          recordKind: "occurrence",
        },
      ],
      context: { interval, coverage: { state: "untracked_coverage" }, currentState: [] },
    };
    const message = coverageMessage(next.context?.coverage?.state, {
      hasEvidence: next.evidence.length > 0,
    });
    expect(next.evidence).toHaveLength(1);
    expect(message).toBe("Collection completeness has not been verified.");
    expect(message).not.toMatch(/missing|unreliable|empty/i);
  });
});
