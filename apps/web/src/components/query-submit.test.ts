import { describe, expect, it } from "vitest";
import { emptyQueryMessage } from "./query-submit";

describe("empty query submission", () => {
  it("asks for a question instead of sending an empty query", () => {
    expect(emptyQueryMessage("")).toBe("Enter a question before asking.");
    expect(emptyQueryMessage("   ")).toBe("Enter a question before asking.");
  });

  it("allows a question that contains text", () => {
    expect(emptyQueryMessage("What changed this week?")).toBeNull();
  });
});
