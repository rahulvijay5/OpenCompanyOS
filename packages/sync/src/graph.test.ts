import { describe, expect, it } from "vitest";
import { projectCanonicalGraph } from "./graph.js";

describe("projectCanonicalGraph", () => {
  it("links a person as author of an issue in a repository", () => {
    const graph = projectCanonicalGraph({
      sourceEventId: "github:issue:42",
      payload: {
        title: "Fix billing",
        number: 7,
        userLogin: "alice",
        fullName: "opencompanyos-org/company-brain",
        htmlUrl: "https://github.com/opencompanyos-org/company-brain/issues/7",
      },
    });

    expect(graph.entities.map((entity) => entity.type).sort()).toEqual([
      "Issue",
      "Person",
      "Repository",
    ]);
    expect(graph.actor).toEqual({
      type: "Person",
      sourceId: "github:user:alice",
    });
    expect(graph.object).toEqual({
      type: "Issue",
      sourceId: "github:issue:42",
    });
    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        {
          source: graph.actor,
          relationshipType: "AUTHORED",
          target: graph.object,
        },
        {
          source: graph.object,
          relationshipType: "BELONGS_TO",
          target: {
            type: "Repository",
            sourceId: "github:repo:opencompanyos-org/company-brain",
          },
        },
      ]),
    );
  });

  it("records a commit as modifying its repository", () => {
    const graph = projectCanonicalGraph({
      sourceEventId: "github:commit:abc123",
      payload: {
        sha: "abc123",
        message: "ship webhook ingest",
        authorLogin: "bob",
        fullName: "opencompanyos-org/company-brain",
      },
    });

    expect(graph.relationships.some((edge) => edge.relationshipType === "MODIFIES")).toBe(
      true,
    );
    expect(graph.object?.type).toBe("Commit");
  });

  it("projects opened and closed occurrences onto one issue", () => {
    const opened = projectCanonicalGraph({
      sourceEventId: "github:issue:42:opened:2026-01-01T00:00:00Z",
      payload: {
        id: 42,
        title: "Fix billing",
        number: 7,
        state: "open",
        userLogin: "alice",
        fullName: "opencompanyos-org/company-brain",
      },
    });
    const closed = projectCanonicalGraph({
      sourceEventId: "github:issue:42:closed:2026-01-02T00:00:00Z",
      payload: {
        id: 42,
        title: "Fix billing",
        number: 7,
        state: "closed",
        userLogin: "alice",
        fullName: "opencompanyos-org/company-brain",
      },
    });

    expect(opened.object?.sourceId).toBe("github:issue:42");
    expect(closed.object?.sourceId).toBe("github:issue:42");
    const issue = closed.entities.find((entity) => entity.type === "Issue");
    expect(issue?.metadata.state).toBe("closed");
  });

  it("links a pull request conversation comment without creating an issue", () => {
    const graph = projectCanonicalGraph({
      sourceEventId: "github:issue_comment:9",
      payload: {
        body: "Looks good",
        userLogin: "carol",
        pullRequestId: 77,
        issueNumber: 4,
        fullName: "opencompanyos-org/company-brain",
      },
    });

    expect(graph.entities.some((entity) => entity.type === "Issue")).toBe(false);
    expect(graph.entities.some((entity) => entity.type === "Review")).toBe(false);
    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        {
          source: { type: "Comment", sourceId: "github:issue_comment:9" },
          relationshipType: "DISCUSSES",
          target: { type: "PullRequest", sourceId: "github:pull_request:77" },
        },
      ]),
    );
  });

  it("does not discuss an unresolved comment", () => {
    const graph = projectCanonicalGraph({
      sourceEventId: "github:issue_comment:10",
      payload: {
        body: "orphan",
        issueNumber: 404,
        association: "unresolved",
        fullName: "opencompanyos-org/company-brain",
      },
    });
    expect(graph.relationships.some((edge) => edge.relationshipType === "DISCUSSES")).toBe(
      false,
    );
  });
});
