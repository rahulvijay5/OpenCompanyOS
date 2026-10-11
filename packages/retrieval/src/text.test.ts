import { describe, expect, it } from "vitest";
import {
  chunkText,
  discussionContentTokens,
  extractQueryConstraints,
  fuseHits,
  keywordOrQuery,
  lexicalDocumentText,
  retainTopicComments,
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
    expect(keywordOrQuery("tutorial001")).toBe("tutorial001:*");
    expect(keywordOrQuery("sql_databases/tutorial001_an_py310.py")).toBe(
      "sql:* | databases:* | tutorial001:* | py310:*",
    );
  });
});

describe("lexicalDocumentText", () => {
  it("does not keep event-type words that the query would match by themselves", () => {
    const comment = lexicalDocumentText(
      "issue_comment.backfill",
      "issue_comment.backfill\nfastapi/fastapi\nroadmap items",
    );
    expect(comment.toLowerCase()).not.toMatch(/\bcomment\b/);
    expect(comment.toLowerCase()).not.toMatch(/\bissue\b/);
    expect(comment).toContain("roadmap items");

    const pull = lexicalDocumentText(
      "Support SkipJsonSchema",
      "pull_request.merged\nfastapi/fastapi\nclosed",
    );
    expect(pull).toContain("Support SkipJsonSchema");
    expect(pull.toLowerCase()).not.toMatch(/\bpull\b/);
    expect(pull.toLowerCase()).not.toMatch(/\brequest\b/);

    const prose = lexicalDocumentText(
      "Note",
      "This comment discusses the issue and the pull request.",
    );
    expect(prose).toContain("comment");
    expect(prose).toContain("issue");
    expect(prose).toContain("pull request");
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

const roadmap = "A list of PRs mapped with these roadmap items";
const maintenance = "That is a major issue IMO. We've deployed a FastAPI app";
const rfc = "Small comment regarding Errors based on RFC 7807";
const refresh = "Don't you plan on adding RefreshUrl to the OAuth2 Password Flow?";
const classView = "Is there any plans to add class based view natively";
const skipJson = "excluding the parameter from openapi schema using the SkipJsonSchema";
const botBranch = "Comparing eltoder:feature/skip-json-schema __CODSPEED_PERFORMANCE_REPORT_COMMENT__";
const gzip = "https://fastapi.tiangolo.com/advanced/middleware/#gzipmiddleware";
const thanks = "Yes, thank you!!";

describe("discussion topic tokens", () => {
  it("keeps a roadmap comment and drops comments that lack that topic", () => {
    const tokens = discussionContentTokens(
      "What does a stored comment on open issue #10370 say about the roadmap?",
    );
    expect(tokens).toEqual(["roadmap"]);
    expect(
      retainTopicComments(
        [
          { text: roadmap },
          { text: maintenance },
          { text: rfc },
          { text: refresh },
          { text: classView },
        ],
        tokens,
      ).map((comment) => comment.text),
    ).toEqual([roadmap]);
  });

  it("keeps SkipJsonSchema and drops a hyphenated bot branch comment", () => {
    const tokens = discussionContentTokens(
      "What does a stored conversation comment on pull request #16465 say about SkipJsonSchema?",
    );
    expect(tokens).toEqual(["skipjsonschema"]);
    expect(
      retainTopicComments([{ text: skipJson }, { text: botBranch }], tokens).map(
        (comment) => comment.text,
      ),
    ).toEqual([skipJson]);
  });

  it("treats a whole-conversation question as having no topic token", () => {
    const tokens = discussionContentTokens(
      "What does a stored conversation comment on pull request #16480 say?",
    );
    expect(tokens).toEqual([]);
    expect(retainTopicComments([{ text: thanks }, { text: botBranch }], tokens)).toHaveLength(2);
  });

  it("does not treat a branch-name piece as a discussion topic", () => {
    const tokens = ["bytearray"];
    expect(
      retainTopicComments(
        [{ text: "jasraj1111:support-bytearray-encoder" }],
        tokens,
      ),
    ).toEqual([]);
    expect(
      retainTopicComments(
        [{ text: "We should support bytearray in the encoder." }],
        tokens,
      ).map((comment) => comment.text),
    ).toEqual(["We should support bytearray in the encoder."]);
  });
  it("does not treat compression comments as topical matches when those words are absent", () => {
    const tokens = discussionContentTokens(
      "What does a stored comment on issue #5833 say about response compression?",
    );
    expect(tokens).toEqual(["response", "compression"]);
    expect(retainTopicComments([{ text: gzip }, { text: thanks }], tokens)).toEqual([]);
  });
});
