import type { Database } from "@opencompanyos/db";
import { describe, expect, it } from "vitest";
import { searchEvidence, selectCappedEvidence } from "./search.js";

function sqlText(chunk: unknown): string {
  if (typeof chunk === "string" || typeof chunk === "number") {
    return String(chunk);
  }
  if (!chunk || typeof chunk !== "object") {
    return "";
  }
  const record = chunk as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.map(sqlText).join("");
  }
  if (Array.isArray(record.value) && record.value.every((part) => typeof part === "string")) {
    return record.value.join("");
  }
  if ("value" in record) {
    return sqlText(record.value);
  }
  return "";
}

function fakeDb(capture: string[]): Database {
  return {
    execute(query: { queryChunks?: unknown[] }) {
      capture.push(sqlText(query));
      return Promise.resolve([]);
    },
  } as unknown as Database;
}

describe("evidence cap", () => {
  it("drops higher-ranked snapshots before the cap when the kind is a comment", () => {
    const ranked = [
      ...Array.from({ length: 8 }, (_, index) => ({
        sourceId: `github:issue:${index}`,
      })),
      { sourceId: "github:issue_comment:1745618744" },
    ];
    expect(
      selectCappedEvidence(ranked, "github:issue_comment:").map((row) => row.sourceId),
    ).toEqual(["github:issue_comment:1745618744"]);
    expect(selectCappedEvidence(ranked, undefined)).toHaveLength(8);
    expect(selectCappedEvidence(ranked, undefined)[0]?.sourceId).toBe("github:issue:0");
  });

  it("excludes conversation comments from a review cap", () => {
    expect(
      selectCappedEvidence(
        [
          { sourceId: "github:issue_comment:6036051915" },
          { sourceId: "github:pull_request_review:9" },
        ],
        "github:pull_request_review:",
      ).map((row) => row.sourceId),
    ).toEqual(["github:pull_request_review:9"]);
  });
});

describe("search constraints", () => {
  it("applies the source prefix before the candidate limit and keeps scope and time", async () => {
    const capture: string[] = [];
    await searchEvidence(fakeDb(capture), {
      tenantId: "tenant-1",
      repositoryIds: ["repo-1"],
      text: "What does a stored comment on issue #5833 say?",
      since: new Date("2023-01-03T15:06:48Z"),
      until: new Date("2023-01-03T19:19:54Z"),
      config: null,
      sourceIdPrefix: "github:issue_comment:",
      subjectNumbers: [5833],
    });
    const statement = capture[0] ?? "";
    expect(statement.indexOf("source_id LIKE")).toBeGreaterThan(-1);
    expect(statement.indexOf("source_id LIKE")).toBeLessThan(statement.indexOf("LIMIT"));
    expect(statement).toContain("repositoryId");
    expect(statement).toContain("event_time >=");
    expect(statement).toContain("event_time <=");
    expect(statement).toContain("issueNumber");
    expect(statement).toContain("github:issue!_comment:%");
    expect(statement).toContain("5833");
  });

  it("does not add a subject-number predicate to an ordinary metadata query", async () => {
    const capture: string[] = [];
    await searchEvidence(fakeDb(capture), {
      tenantId: "tenant-1",
      repositoryIds: ["repo-1"],
      text: "mangum #16451",
      since: new Date("2026-10-02T04:34:43Z"),
      until: new Date("2026-10-02T04:34:43Z"),
      config: null,
    });
    const statement = capture[0] ?? "";
    expect(statement).not.toContain("issueNumber");
    expect(statement).toContain("repositoryId");
    expect(statement).toContain("event_time >=");
    expect(statement).toContain("event_time <=");
    expect(statement.indexOf("LIMIT")).toBeGreaterThan(-1);
  });

  it("requires topic words and the parent number before the limit for a focused comment question", async () => {
    const capture: string[] = [];
    await searchEvidence(fakeDb(capture), {
      tenantId: "tenant-1",
      repositoryIds: ["repo-1"],
      text: "What does a stored comment on open issue #10370 say about the roadmap?",
      since: new Date("2023-10-03T19:45:49Z"),
      until: new Date("2023-10-14T09:10:50Z"),
      config: null,
      sourceIdPrefix: "github:issue_comment:",
      subjectNumbers: [10370],
      discussionContentTokens: ["roadmap"],
    });
    expect(capture).toHaveLength(1);
    const statement = capture[0] ?? "";
    expect(statement).toContain("issueNumber");
    expect(statement).toContain("10370");
    expect(statement).toContain("roadmap");
    expect(statement).toContain("roadmap:*");
    expect(statement).toContain("[-_:/]");
    expect(statement.indexOf("issueNumber")).toBeLessThan(statement.indexOf("LIMIT"));
    expect(statement).toContain("event_time >=");
    expect(statement).toContain("event_time <=");
    expect(statement).toContain("repositoryId");
  });

  it("keeps every parent comment for a conversation question with no topic token", async () => {
    const capture: string[] = [];
    await searchEvidence(fakeDb(capture), {
      tenantId: "tenant-1",
      repositoryIds: ["repo-1"],
      text: "What does a stored conversation comment on pull request #16480 say?",
      since: new Date("2026-10-10T08:56:58Z"),
      until: new Date("2026-10-10T09:53:40Z"),
      config: null,
      sourceIdPrefix: "github:issue_comment:",
      subjectNumbers: [16480],
      discussionContentTokens: [],
    });
    const statement = capture[0] ?? "";
    expect(statement).toContain("16480");
    expect(statement).not.toContain("roadmap");
    expect(statement).toContain("repositoryId");
    expect(statement.indexOf("LIMIT")).toBeGreaterThan(statement.indexOf("event_time"));
  });
});
