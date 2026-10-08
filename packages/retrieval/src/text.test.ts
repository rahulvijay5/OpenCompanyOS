import { describe, expect, it } from "vitest";
import {
  chunkText,
  extractQueryConstraints,
  fuseHits,
  keywordOrQuery,
} from "./text.js";

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    expect(chunkText("hello")).toEqual(["hello"]);
  });

  it("splits long text", () => {
    const chunks = chunkText("a".repeat(2500), 1200);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.length).toBe(1200);
  });
});

describe("extractQueryConstraints", () => {
  it("sets a week window for 'this week'", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const constraints = extractQueryConstraints("What changed this week?", now);
    expect(constraints.since?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("keywordOrQuery", () => {
  it("keeps repo and person terms and drops question words", () => {
    expect(keywordOrQuery("What changed in company-brain?")).toBe(
      "changed:* | company:* | brain:*",
    );
    expect(keywordOrQuery("did rahul raised any issues?")).toBe(
      "rahul:* | raised:* | issues:*",
    );
  });
});

describe("fuseHits", () => {
  it("boosts documents found by both retrievers", () => {
    const fused = fuseHits(
      [
        { documentId: "a", score: 0.2 },
        { documentId: "b", score: 0.4 },
      ],
      [{ documentId: "a", score: 0.9 }],
    );
    expect(fused[0]?.documentId).toBe("a");
    expect(fused[0]?.score).toBeGreaterThan(fused[1]?.score ?? 0);
  });
});
