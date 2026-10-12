import { describe, expect, it } from "vitest";
import { scoreRetrieved } from "./discussion-retrieval.js";

describe("discussion retrieval scores", () => {
  it("keeps recall, precision, support, and abstention separate", () => {
    const scored = scoreRetrieved(
      ["github:issue_comment:1", "github:issue_comment:2"],
      ["github:issue_comment:1", "github:issue:9"],
    );
    expect(scored.recall).toBe(0.5);
    expect(scored.precision).toBe(0.5);
    expect(scored.missing).toEqual(["github:issue_comment:2"]);
    expect(scored.extras).toEqual(["github:issue:9"]);
    expect(scored.claimSupport).toBe("mixed");
    expect(scored.abstained).toBe(false);
  });

  it("treats a verified empty retrieval as abstention", () => {
    const scored = scoreRetrieved([], []);
    expect(scored.recall).toBeNull();
    expect(scored.precision).toBeNull();
    expect(scored.claimSupport).toBe("abstained");
    expect(scored.abstained).toBe(true);
  });

  it("does not treat retrieved text as support when nothing is relevant", () => {
    const scored = scoreRetrieved([], ["github:issue:5671616833"]);
    expect(scored.precision).toBe(0);
    expect(scored.claimSupport).toBe("does_not_support");
    expect(scored.abstained).toBe(false);
    expect(scored.extras).toEqual(["github:issue:5671616833"]);
  });
});
