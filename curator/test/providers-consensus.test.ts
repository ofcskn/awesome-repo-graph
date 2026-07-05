import { describe, expect, it } from "vitest";
import { classifyWithFallback, orderProvidersForFallback } from "../src/providers/index.js";
import type { AIProvider, ClassifyRequest } from "../src/providers/types.js";
import { runClassification } from "../src/classification/consensus.js";
import { ProviderRateLimitError, withRetryAndTimeout } from "../src/providers/retry.js";
import { loadConfig } from "../src/config.js";
import type { Candidate, Classification } from "../src/types.js";

function makeClassification(overrides: Partial<Classification> = {}): Classification {
  return {
    canonicalUrl: "https://github.com/a/b",
    title: "b",
    description: "desc",
    taxonomyPath: ["AI Agent Tooling"],
    tags: ["mcp-server"],
    qualityScore: 80,
    relevanceScore: 80,
    maintenanceScore: 80,
    uniquenessScore: 80,
    confidenceScore: 0.9,
    accepted: true,
    rejectionReasons: [],
    evidence: [],
    relatedExistingSourceIds: [],
    ...overrides,
  };
}

function makeProvider(
  name: AIProvider["name"],
  impl: (req: ClassifyRequest) => Promise<Classification>,
): AIProvider {
  return {
    name,
    isConfigured: () => true,
    classify: async (req) => ({
      classification: await impl(req),
      attempts: 1,
      latencyMs: 1,
      totalTokens: null,
    }),
  };
}

const candidate: Candidate = {
  canonicalUrl: "https://github.com/a/b",
  provider: "github.com",
  owner: "a",
  repo: "b",
  title: "b",
  description: "",
  stars: 100,
  forks: 1,
  license: "MIT",
  primaryLanguage: "TypeScript",
  topics: [],
  createdAt: "2024-01-01T00:00:00Z",
  lastPushAt: "2026-06-01T00:00:00Z",
  archived: false,
  isFork: false,
  defaultBranch: "main",
  homepage: null,
  discoveryMethod: "test",
  discoveredAt: new Date().toISOString(),
  githubId: 1,
  parentCanonicalUrl: null,
};

describe("provider fallback", () => {
  it("falls back to the next provider when the first fails", async () => {
    const failing = makeProvider("openai", async () => {
      throw new Error("boom");
    });
    const succeeding = makeProvider("gemini", async () => makeClassification());
    const { config } = loadConfig({});
    const request: ClassifyRequest = {
      candidate,
      existingTaxonomyPaths: [],
      existingTags: [],
      existingSources: [],
      config,
    };
    const result = await classifyWithFallback(request, [failing, succeeding]);
    expect(result.provider).toBe("gemini");
    expect(result.attempts[0]).toMatchObject({ provider: "openai", succeeded: false });
    expect(result.attempts[1]).toMatchObject({ provider: "gemini", succeeded: true, error: null });
  });

  it("orders the primary provider first, then the configured fallback order", () => {
    const { config } = loadConfig({});
    const openai = makeProvider("openai", async () => makeClassification());
    const deepseek = makeProvider("deepseek", async () => makeClassification());
    const gemini = makeProvider("gemini", async () => makeClassification());
    const ordered = orderProvidersForFallback(config, [deepseek, gemini, openai]);
    expect(ordered[0]?.name).toBe(config.providers.primary);
  });
});

describe("consensus", () => {
  it("accepts via the fast single-provider path", async () => {
    const { config } = loadConfig({});
    const provider = makeProvider(config.providers.primary, async () => makeClassification());
    const result = await runClassification(
      candidate,
      { existingTaxonomyPaths: [], existingTags: [], existingSources: [], config },
      [provider],
    );
    expect(result.accepted).toBe(true);
    expect(result.finalClassification?.canonicalUrl).toBe(candidate.canonicalUrl);
  });

  it("defers when provider disagreement pushes weighted acceptance below the consensus threshold", async () => {
    const base = loadConfig({}).config;
    const config = {
      ...base,
      providers: { ...base.providers, consensusStrategy: "weighted-consensus" as const },
      quality: { ...base.quality, consensusThreshold: 0.9 },
    };
    const accepting = makeProvider("openai", async () => makeClassification({ accepted: true }));
    const rejecting = makeProvider("gemini", async () =>
      makeClassification({ accepted: false, rejectionReasons: ["off-topic"] }),
    );
    const result = await runClassification(
      candidate,
      { existingTaxonomyPaths: [], existingTags: [], existingSources: [], config },
      [accepting, rejecting],
    );
    expect(result.accepted).toBe(false);
    expect(result.disagreements.length).toBeGreaterThan(0);
  });

  it("reports provider-error when no usable provider is available", async () => {
    const { config } = loadConfig({});
    const result = await runClassification(
      candidate,
      { existingTaxonomyPaths: [], existingTags: [], existingSources: [], config },
      [],
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons).toContain("provider-error");
  });
});

describe("retry/backoff", () => {
  it("retries on rate-limit errors and eventually succeeds", async () => {
    let calls = 0;
    const { result, attempts } = await withRetryAndTimeout(
      async () => {
        calls += 1;
        if (calls < 3) throw new ProviderRateLimitError();
        return "ok";
      },
      { maxRetries: 3, timeoutMs: 1000, baseDelayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetryAndTimeout(
        async () => {
          calls += 1;
          throw new Error("auth failed");
        },
        { maxRetries: 3, timeoutMs: 1000, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("auth failed");
    expect(calls).toBe(1);
  });
});
