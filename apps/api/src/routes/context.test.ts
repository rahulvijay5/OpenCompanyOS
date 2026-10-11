import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const buildContext = vi.hoisted(() => vi.fn());
const answerFromPackage = vi.hoisted(() => vi.fn());

vi.mock("@opencompanyos/context", async () => {
  const actual = await vi.importActual<typeof import("@opencompanyos/context")>(
    "@opencompanyos/context",
  );
  return {
    ...actual,
    buildContext,
    answerFromPackage,
  };
});

const { contextBodySchema, contextInput, registerContextRoutes } = await import("./context.js");
const { registerQueryRoutes } = await import("./query.js");

const env = null;

describe("context request schema", () => {
  it("keeps a metadata query unchanged when evidenceKind is omitted", () => {
    const parsed = contextBodySchema.parse({ query: "mangum #16451" });
    const input = contextInput("tenant-1", parsed, env);
    expect(input.query).toBe("mangum #16451");
    expect(input).not.toHaveProperty("evidenceKind");
  });

  it("accepts the three evidence kinds and rejects any other value", () => {
    for (const evidenceKind of ["issue_comment", "pull_request_review", "issue_body"] as const) {
      expect(contextBodySchema.parse({ query: "roadmap", evidenceKind }).evidenceKind).toBe(
        evidenceKind,
      );
    }
    expect(contextBodySchema.safeParse({ query: "roadmap", evidenceKind: "comment" }).success).toBe(
      false,
    );
    expect(contextBodySchema.safeParse({ query: "roadmap", evidenceKind: "snapshot" }).success).toBe(
      false,
    );
  });

  it("passes a requested kind through and leaves other fields alone", () => {
    const parsed = contextBodySchema.parse({
      query: "What review decision is stored?",
      evidenceKind: "pull_request_review",
    });
    expect(contextInput("tenant-1", parsed, env)).toMatchObject({
      tenantId: "tenant-1",
      query: "What review decision is stored?",
      evidenceKind: "pull_request_review",
      config: null,
    });
  });
});

describe("query and context routes", () => {
  beforeEach(() => {
    buildContext.mockReset();
    answerFromPackage.mockReset();
    buildContext.mockResolvedValue({
      version: 1,
      evidence: [{ id: "e1", sourceId: "github:issue:1", title: "Snapshot", url: null, snippet: null, score: 1, repositoryId: null }],
      uncertainties: [],
      subject: { status: "unresolved" },
      currentState: [],
      events: [],
      relationships: [],
      scope: { tenantId: "tenant-1", repositoryIds: [], authorization: "local-owner" },
    });
    answerFromPackage.mockResolvedValue({
      answer: "listed",
      confidence: 0,
      evidence: [],
      uncertainties: [],
      traceId: "trace-1",
    });
  });

  it("forwards the kind on both routes and omits it for a plain UI query", async () => {
    const app = Fastify();
    const ctx = { db: {} as never, tenantId: "tenant-1", userId: "user-1" };
    await registerContextRoutes(app, ctx, () => null);
    await registerQueryRoutes(app, ctx, () => null);

    const contextResponse = await app.inject({
      method: "POST",
      url: "/api/v1/context",
      payload: { query: "comment on #16451", evidenceKind: "issue_comment" },
    });
    expect(contextResponse.statusCode).toBe(200);
    expect(buildContext).toHaveBeenCalledWith(
      ctx.db,
      expect.objectContaining({ evidenceKind: "issue_comment", query: "comment on #16451" }),
    );

    const reviewResponse = await app.inject({
      method: "POST",
      url: "/api/v1/query",
      payload: { query: "review decision", evidenceKind: "pull_request_review" },
    });
    expect(reviewResponse.statusCode).toBe(200);
    expect(buildContext).toHaveBeenLastCalledWith(
      ctx.db,
      expect.objectContaining({ evidenceKind: "pull_request_review" }),
    );

    const uiResponse = await app.inject({
      method: "POST",
      url: "/api/v1/query",
      payload: { query: "What changed this week?" },
    });
    expect(uiResponse.statusCode).toBe(200);
    const uiInput = buildContext.mock.calls.at(-1)?.[1] as { evidenceKind?: string };
    expect(uiInput.evidenceKind).toBeUndefined();

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/context",
      payload: { query: "body", evidenceKind: "issue" },
    });
    expect(rejected.statusCode).toBe(400);
    await app.close();
  });
});
