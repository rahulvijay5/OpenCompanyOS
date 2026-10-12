import { describe, expect, it } from "vitest";
import { resolveIndexConfig } from "./events.js";

describe("resolveIndexConfig", () => {
  it("uses null as full-text indexing and does not consult an embedding endpoint", () => {
    expect(resolveIndexConfig(null)).toBeNull();
  });

  it("returns an explicit config object unchanged", () => {
    const config = {
      baseUrl: "http://127.0.0.1:9",
      apiKey: "unused",
      chatModel: "fake",
      embeddingModel: "fake",
      embeddingDimensions: 768,
    };
    expect(resolveIndexConfig(config)).toBe(config);
  });
});
