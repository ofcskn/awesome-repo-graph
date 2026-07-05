import { describe, expect, it } from "vitest";
import { emptyTokenSummary, TokenAccumulator } from "../src/reporting/token-accounting.js";

describe("TokenAccumulator", () => {
  it("aggregates per-provider and per-stage classification totals", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "openai", "gpt-5.5", 1000);
    acc.record("classification", "openai", "gpt-5.5", 500);
    acc.record("classification", "gemini", "gemini-2.5-flash", 200);

    const summary = acc.summarize();

    const openai = summary.byProvider.find((r) => r.provider === "openai")!;
    expect(openai.totalTokens).toBe(1500);
    expect(openai.calls).toBe(2);
    expect(openai.model).toBe("gpt-5.5");

    const gemini = summary.byProvider.find((r) => r.provider === "gemini")!;
    expect(gemini.totalTokens).toBe(200);

    expect(summary.byStage.classification.totalTokens).toBe(1700);
    expect(summary.totalTokens).toBe(1700);
  });

  it("computes estimated cost from tokens x rate", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "openai", "gpt-5.5", 1_000_000); // $5.00 / 1M
    const summary = acc.summarize();
    expect(summary.estimatedCostUsd).toBeCloseTo(5.0, 10);
    expect(summary.byStage.classification.estimatedCostUsd).toBeCloseTo(5.0, 10);
  });

  it("keeps a provider that never reports usage at null tokens and null cost (not zero)", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "deepseek", "deepseek-v4-pro", null);
    acc.record("classification", "deepseek", "deepseek-v4-pro", null);
    const summary = acc.summarize();
    const deepseek = summary.byProvider.find((r) => r.provider === "deepseek")!;
    expect(deepseek.calls).toBe(2);
    expect(deepseek.callsWithoutUsage).toBe(2);
    expect(deepseek.totalTokens).toBeNull();
    expect(deepseek.estimatedCostUsd).toBeNull();
  });

  it("sums only the numeric calls when usage is mixed null + reported", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "openai", "gpt-5.5", 800);
    acc.record("classification", "openai", "gpt-5.5", null);
    const summary = acc.summarize();
    const openai = summary.byProvider.find((r) => r.provider === "openai")!;
    expect(openai.totalTokens).toBe(800);
    expect(openai.callsWithoutUsage).toBe(1);
    expect(openai.calls).toBe(2);
  });

  it("reports the grand total as null when nothing anywhere reported usage", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "deepseek", "deepseek-v4-pro", null);
    acc.record("embeddings", "vertexGemini", "gemini-embedding-001", null);
    const summary = acc.summarize();
    expect(summary.totalTokens).toBeNull();
    expect(summary.estimatedCostUsd).toBeNull();
    expect(summary.byStage.embeddings.totalTokens).toBeNull();
  });

  it("marks the model null when a bucket mixes models", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "openai", "gpt-5.5", 100);
    acc.record("classification", "openai", "gpt-6", 100);
    const summary = acc.summarize();
    const openai = summary.byProvider.find((r) => r.provider === "openai")!;
    expect(openai.model).toBeNull();
    // Unknown blended model -> cost cannot be estimated.
    expect(openai.estimatedCostUsd).toBeNull();
    expect(openai.totalTokens).toBe(200);
  });

  it("separates stages and keeps byProvider sorted for clean diffs", () => {
    const acc = new TokenAccumulator();
    acc.record("embeddings", "vertexGemini", "gemini-embedding-001", null);
    acc.record("classification", "openai", "gpt-5.5", 10);
    const summary = acc.summarize();
    // Sorted by (stage, provider): classification rows precede embeddings rows.
    expect(summary.byProvider[0]!.stage).toBe("classification");
    expect(summary.byProvider[summary.byProvider.length - 1]!.stage).toBe("embeddings");
    expect(summary.byStage.classification.totalTokens).toBe(10);
    expect(summary.byStage.embeddings.totalTokens).toBeNull();
  });

  it("exposes the distinct set of models used", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "openai", "gpt-5.5", 10);
    acc.record("classification", "gemini", "gemini-2.5-flash", 10);
    acc.record("classification", "openai", "gpt-5.5", 10);
    expect(acc.modelsUsed()).toEqual(["gemini-2.5-flash", "gpt-5.5"]);
  });

  it("produces a well-formed empty summary when nothing was recorded", () => {
    const summary = emptyTokenSummary();
    expect(summary.totalTokens).toBeNull();
    expect(summary.estimatedCostUsd).toBeNull();
    expect(summary.byProvider).toEqual([]);
    expect(summary.byStage.classification.totalTokens).toBeNull();
    expect(summary.byStage.embeddings.totalTokens).toBeNull();
    expect(summary.estimateBasis).toBe("config-price-table");
  });
});
