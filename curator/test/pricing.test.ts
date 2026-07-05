import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_TABLE, estimateCostUsd } from "../src/pricing.js";

describe("estimateCostUsd", () => {
  it("computes tokens x rate for a known model", () => {
    // 2,000,000 tokens of gpt-5.5 at $5.00 / 1M = $10.00
    expect(estimateCostUsd("gpt-5.5", 2_000_000)).toBeCloseTo(10.0, 10);
  });

  it("scales linearly with token count", () => {
    const one = estimateCostUsd("gemini-2.5-flash", 1_000_000)!;
    const half = estimateCostUsd("gemini-2.5-flash", 500_000)!;
    expect(half).toBeCloseTo(one / 2, 10);
  });

  it("returns null (not zero) for an unknown/unpriced model", () => {
    expect(estimateCostUsd("some-unlisted-model", 1_000_000)).toBeNull();
  });

  it("returns null when tokens are null (usage not reported)", () => {
    expect(estimateCostUsd("gpt-5.5", null)).toBeNull();
  });

  it("returns null when model is null", () => {
    expect(estimateCostUsd(null, 1_000_000)).toBeNull();
  });

  it("returns 0 only for a genuine zero token count on a priced model", () => {
    expect(estimateCostUsd("gpt-5.5", 0)).toBe(0);
  });

  it("honors an overridden price table", () => {
    const table = { "custom-model": { usdPer1MTokens: 100 } };
    expect(estimateCostUsd("custom-model", 1_000_000, table)).toBeCloseTo(100, 10);
    // A model priced in the default table is unknown under the override.
    expect(estimateCostUsd("gpt-5.5", 1_000_000, table)).toBeNull();
  });

  it("prices every model referenced by the default config", () => {
    for (const model of ["gpt-5.5", "deepseek-v4-pro", "gemini-2.5-flash"]) {
      expect(DEFAULT_PRICE_TABLE[model]).toBeDefined();
    }
  });
});
