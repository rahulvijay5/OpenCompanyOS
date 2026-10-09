import { describe, expect, it } from "vitest";
import { selectCitedEvidence } from "./resolve.js";
import {
  intersectRepositoryScope,
  issueNumbers,
  matchExactLogin,
  partitionOccurrences,
  resolveCandidates,
  selectObservedOccurrences,
} from "./index.js";
import type { ContextEntityRef, ContextEvent, ContextEvidence } from "./types.js";

const person = (login: string): ContextEntityRef => ({
  id: login,
  type: "Person",
  canonicalName: login,
  sourceId: `github:user:${login}`,
});

describe("exact resolution", () => {
  it("does not treat a shorter login as the same person", () => {
    const matches = matchExactLogin("did rahul open an issue?", [
      person("rahulvijay5"),
    ]);
    expect(matches).toEqual([]);
    expect(resolveCandidates(matches).status).toBe("unresolved");
  });

  it("matches an exact login", () => {
    const matches = matchExactLogin("did rahulvijay5 open an issue?", [
      person("rahulvijay5"),
      person("rahul"),
    ]);
    expect(matches.map((item) => item.canonicalName)).toEqual(["rahulvijay5"]);
  });

  it("marks two issues with the same number as ambiguous", () => {
    const subject = resolveCandidates([
      {
        id: "a",
        type: "Issue",
        canonicalName: "Issue 8 in web",
        sourceId: "github:issue:1",
      },
      {
        id: "b",
        type: "Issue",
        canonicalName: "Issue 8 in api",
        sourceId: "github:issue:2",
      },
    ]);
    expect(subject.status).toBe("ambiguous");
    if (subject.status === "ambiguous") {
      expect(subject.candidates).toHaveLength(2);
    }
    expect(issueNumbers("What is the state of issue #8?")).toEqual([8]);
  });

  it("drops a repository id that is not selected", () => {
    const scope = intersectRepositoryScope(
      [{ id: "selected", fullName: "org/selected" }],
      ["selected", "other"],
    );
    expect(scope.repositoryIds).toEqual(["selected"]);
    expect(scope.rejected).toEqual(["other"]);
  });
});

describe("evidence and time", () => {
  const evidence: ContextEvidence[] = [
    {
      id: "kept",
      sourceId: "github:issue:1",
      title: "Kept",
      url: "https://github.com/org/repo/issues/1",
      snippet: "stored",
      score: 1,
      repositoryId: "repo",
    },
  ];

  it("removes unknown evidence ids and keeps the stored url", () => {
    const cited = selectCitedEvidence(evidence, ["missing", "kept"]);
    expect(cited).toEqual(evidence);
    expect(cited[0]?.url).toBe("https://github.com/org/repo/issues/1");
  });

  it("keeps a snapshot out of the occurrence window", () => {
    const occurrence: ContextEvent = {
      recordKind: "occurrence",
      id: "old",
      eventType: "issues.closed",
      sourceEventId: "github:issue:1:closed:2020-01-01T00:00:00Z",
      eventTime: "2020-01-01T00:00:00.000Z",
      observedAt: "2026-10-09T00:00:00.000Z",
      title: "Old close",
      url: null,
    };
    const rows = selectObservedOccurrences([
      { recordKind: "snapshot", createdAt: "2020-01-01", closedAt: "2020-01-02" },
      occurrence,
    ]);
    expect(rows).toEqual([occurrence]);
    const partitioned = partitionOccurrences(
      [occurrence],
      new Date("2026-01-01T00:00:00Z"),
      null,
    );
    expect(partitioned.included).toEqual([]);
  });
});
