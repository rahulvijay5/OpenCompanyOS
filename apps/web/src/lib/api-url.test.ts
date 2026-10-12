import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./api";

describe("API URL selection", () => {
  it("uses the Compose service URL for server-side requests", () => {
    expect(
      resolveApiUrl({
        server: true,
        internalUrl: "http://api:4000",
        publicUrl: "http://localhost:4000",
      }),
    ).toBe("http://api:4000");
  });

  it("uses the public URL in the browser and for the install link", () => {
    expect(
      resolveApiUrl({
        server: false,
        internalUrl: "http://api:4000",
        publicUrl: "http://localhost:4000",
      }),
    ).toBe("http://localhost:4000");
  });
});
