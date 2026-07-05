import { describe, expect, it } from "vitest";
import { cosineSimilarity, findNearest } from "../src/embeddings/similarity.js";
import type { EmbeddingProvider } from "../src/embeddings/types.js";
import {
  candidateEmbeddingText,
  computeTextHash,
  existingSourceEmbeddingText,
  syncEmbeddings,
} from "../src/memory/embedding-store.js";
import type { StoredSource } from "../src/store-bridge.js";
import { findDuplicates } from "../src/validation/dedupe.js";
import type { Candidate } from "../src/types.js";
import { configSchema } from "../src/config.js";
import { loadConfig } from "../src/config.js";

function makeFakeProvider(vectorFor: (text: string) => number[]): EmbeddingProvider {
  return {
    name: "openai",
    isConfigured: () => true,
    embed: async (texts) => texts.map(vectorFor),
  };
}

function makeSource(overrides: Partial<StoredSource> = {}): StoredSource {
  return {
    id: "a",
    url: "https://github.com/o/a",
    provider: "github.com",
    owner: "o",
    repo: "a",
    title: "a",
    description: "An agent framework.",
    path: ["AI Agent Tooling"],
    tags: ["ai-agent"],
    license: "MIT",
    score: { stars: 100, fetchedAt: "2026-07-01" },
    addedAt: "2026-01-01",
    ...overrides,
  };
}

describe("cosine similarity / nearest-neighbor search", () => {
  it("scores identical vectors as maximally similar", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("scores orthogonal vectors as unrelated", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("ranks candidates by similarity, highest first", () => {
    const query = [1, 0];
    const results = findNearest(
      query,
      [
        { vector: [0, 1], item: "orthogonal" },
        { vector: [0.9, 0.1], item: "close" },
        { vector: [1, 0], item: "identical" },
      ],
      2,
    );
    expect(results.map((r) => r.item)).toEqual(["identical", "close"]);
  });
});

describe("embedding text builders and hashing", () => {
  it("produces a deterministic hash for the same text", () => {
    expect(computeTextHash("hello")).toBe(computeTextHash("hello"));
  });

  it("produces different hashes for different text", () => {
    expect(computeTextHash("hello")).not.toBe(computeTextHash("goodbye"));
  });

  it("builds existing-source text from title/description/path/tags (post-classification fields)", () => {
    const text = existingSourceEmbeddingText(makeSource());
    expect(text).toContain("An agent framework.");
    expect(text).toContain("AI Agent Tooling");
    expect(text).toContain("ai-agent");
  });

  it("builds candidate text from raw repo metadata only (no taxonomy/tags exist yet)", () => {
    const candidate: Candidate = {
      canonicalUrl: "https://github.com/o/b",
      provider: "github.com",
      owner: "o",
      repo: "b",
      title: "b",
      description: "Another agent framework.",
      stars: 50,
      forks: 0,
      license: null,
      primaryLanguage: "Python",
      topics: ["ai-agent", "llm"],
      createdAt: null,
      lastPushAt: null,
      archived: false,
      isFork: false,
      defaultBranch: "main",
      homepage: null,
      discoveryMethod: "test",
      discoveredAt: new Date().toISOString(),
      githubId: 2,
      parentCanonicalUrl: null,
    };
    const text = candidateEmbeddingText(candidate);
    expect(text).toContain("Another agent framework.");
    expect(text).toContain("ai-agent");
    expect(text).toContain("Python");
  });
});

// syncEmbeddings takes previousRecords/persist explicitly rather than reading
// curator/state/embeddings.json itself, specifically so its diffing logic can
// be exercised here without touching the real repo state file.
describe("incremental embedding sync", () => {
  const provider = makeFakeProvider((text) => [text.length, text.length % 7]);

  it("embeds every source on first sync (empty previous store)", async () => {
    const { store, result } = await syncEmbeddings([makeSource()], [], provider, "fake-model", 2, false);
    expect(result).toEqual({ embedded: 1, skipped: 0, removed: 0 });
    expect(store).toHaveLength(1);
    expect(store[0]?.sourceId).toBe("a");
  });

  it("skips re-embedding an unchanged source on the next sync", async () => {
    const first = await syncEmbeddings([makeSource()], [], provider, "fake-model", 2, false);
    const second = await syncEmbeddings([makeSource()], first.store, provider, "fake-model", 2, false);
    expect(second.result).toEqual({ embedded: 0, skipped: 1, removed: 0 });
  });

  it("re-embeds a source whose tags changed (textHash mismatch)", async () => {
    const first = await syncEmbeddings([makeSource()], [], provider, "fake-model", 2, false);
    const changed = makeSource({ tags: ["ai-agent", "python"] });
    const second = await syncEmbeddings([changed], first.store, provider, "fake-model", 2, false);
    expect(second.result).toEqual({ embedded: 1, skipped: 0, removed: 0 });
  });

  it("prunes a source that no longer exists in sources.json", async () => {
    const first = await syncEmbeddings([makeSource()], [], provider, "fake-model", 2, false);
    const second = await syncEmbeddings([], first.store, provider, "fake-model", 2, false);
    expect(second.result).toEqual({ embedded: 0, skipped: 0, removed: 1 });
    expect(second.store).toHaveLength(0);
  });
});

describe("semantic near-duplicate detection via embeddings", () => {
  const candidate: Candidate = {
    canonicalUrl: "https://github.com/mirror/repo",
    provider: "github.com",
    owner: "mirror",
    repo: "repo",
    title: "totally different name",
    description: "unrelated wording",
    stars: 10,
    forks: 0,
    license: null,
    primaryLanguage: null,
    topics: [],
    createdAt: null,
    lastPushAt: null,
    archived: false,
    isFork: false,
    defaultBranch: "main",
    homepage: null,
    discoveryMethod: "test",
    discoveredAt: new Date().toISOString(),
    githubId: 99,
    parentCanonicalUrl: null,
  };
  const existingSources: StoredSource[] = [makeSource({ id: "existing", url: "https://github.com/o/existing" })];

  it("flags a candidate as a semantic near-duplicate above the similarity threshold", async () => {
    const matches = await findDuplicates(candidate, existingSources, [], false, {
      candidateEmbedding: [1, 0, 0],
      existingEmbeddings: [{ sourceId: "existing", vector: [1, 0, 0] }],
      threshold: 0.9,
    });
    expect(matches.some((m) => m.matchType === "semantic-near-duplicate")).toBe(true);
  });

  it("does not flag a genuinely dissimilar candidate", async () => {
    const matches = await findDuplicates(candidate, existingSources, [], false, {
      candidateEmbedding: [1, 0, 0],
      existingEmbeddings: [{ sourceId: "existing", vector: [0, 1, 0] }],
      threshold: 0.9,
    });
    expect(matches.some((m) => m.matchType === "semantic-near-duplicate")).toBe(false);
  });
});

describe("embeddings config", () => {
  it("excludes deepseek as an embeddings provider (no DeepSeek embeddings API)", () => {
    const base = loadConfig({}).config;
    const result = configSchema.safeParse({ ...base, embeddings: { ...base.embeddings, provider: "deepseek" } });
    expect(result.success).toBe(false);
  });

  it("defaults to a real embedding-capable provider", () => {
    const { config } = loadConfig({});
    expect(["openai", "gemini", "vertexGemini"]).toContain(config.embeddings.provider);
  });
});
