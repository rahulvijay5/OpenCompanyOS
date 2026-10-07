import { describe, expect, it } from "vitest";
import { buildInstallUrl } from "./index.js";

describe("buildInstallUrl", () => {
  it("builds the GitHub App installation URL", () => {
    expect(buildInstallUrl("opencompanyos-local")).toBe(
      "https://github.com/apps/opencompanyos-local/installations/new",
    );
  });

  it("includes optional state", () => {
    const url = buildInstallUrl("opencompanyos-local", "abc");
    expect(url).toContain("state=abc");
  });
});
