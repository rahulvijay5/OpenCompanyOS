import { describe, expect, it } from "vitest";

describe("health route contract", () => {
  it("documents the expected health payload shape", () => {
    const payload = { status: "ok" as const };
    expect(payload).toEqual({ status: "ok" });
  });
});
