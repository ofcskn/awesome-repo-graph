import { describe, expect, it } from "vitest";
import { findDuplicates } from "../src/validation/dedupe.js";
import { normalizeSourceUrl } from "../src/store-bridge.js";
import type { StoredSource } from "../src/store-bridge.js";
import type { Candidate, RejectionRecord } from "../src/types.js";
import { getExistingTaxonomyPaths, TaxonomyBudget } from "../src/classification/taxonomy.js";
import { getExistingTags, normalizeAndCapTags, normalizeTag, TagBudget } from "../src/classification/tags.js";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    canonicalUrl: "https://github.com/newowner/newrepo",
    provider: "github.com",
    owner: "newowner",
    repo: "newrepo",
    title: "newrepo",
    description: "",
    stars: 500,
    forks: 10,
    license: "MIT",
    primaryLanguage: "TypeScript",
    topics: ["ai-agent"],
    createdAt: "2024-01-01T00:00:00Z",
    lastPushAt: "2026-06-01T00:00:00Z",
    archived: false,
    isFork: false,
    defaultBranch: "main",
    homepage: null,
    discoveryMethod: "github-search:test",
    discoveredAt: new Date().toISOString(),
    githubId: 123,
    parentCanonicalUrl: null,
    ...overrides,
  };
}

const existingSources: StoredSource[] = [
  {
    id: "existingowner-existingrepo",
    url: "https://github.com/existingowner/existingrepo",
    provider: "github.com",
    owner: "existingowner",
    repo: "existingrepo",
    title: "existingrepo",
    description: "",
    path: ["AI Agent Tooling", "MCP Servers"],
    tags: ["mcp-server", "typescript"],
    license: "MIT",
    score: { stars: 1000, fetchedAt: "2026-07-01" },
    addedAt: "2026-01-01",
  },
];

describe("deduplication", () => {
  it("normalizes URLs consistently across case, trailing slash, query, and hash", () => {
    expect(normalizeSourceUrl("https://GitHub.com/Foo/Bar/")).toBe(
      normalizeSourceUrl("https://github.com/Foo/Bar?x=1#y"),
    );
  });

  it("detects an exact URL duplicate", async () => {
    const candidate = makeCandidate({ canonicalUrl: "https://github.com/existingowner/existingrepo" });
    const matches = await findDuplicates(candidate, existingSources, [], false);
    expect(matches.some((m) => m.matchType === "exact-url")).toBe(true);
  });

  it("does not flag a genuinely new candidate as a duplicate", async () => {
    const matches = await findDuplicates(makeCandidate(), existingSources, [], false);
    expect(matches).toHaveLength(0);
  });

  it("flags near-identical titles as a likely duplicate", async () => {
    const candidate = makeCandidate({
      canonicalUrl: "https://github.com/mirrorowner/existingrepo-mirror",
      title: "existingrepo",
    });
    const matches = await findDuplicates(candidate, existingSources, [], false);
    expect(matches.some((m) => m.matchType === "title-similarity")).toBe(true);
  });

  it("skips the network fork-parent lookup when fork consideration is disabled", async () => {
    const candidate = makeCandidate({ isFork: true, title: "totally-different-name" });
    const matches = await findDuplicates(candidate, existingSources, [], false);
    expect(matches.find((m) => m.matchType === "fork-parent")).toBeUndefined();
  });

  it("flags a previously-rejected URL via rejection history", async () => {
    const rejection: RejectionRecord = {
      canonicalUrl: makeCandidate().canonicalUrl,
      githubId: 123,
      evaluatedAt: new Date().toISOString(),
      reasonCode: "below-min-stars",
      metadataFingerprint: "fp_x",
      reconsiderAt: null,
    };
    const matches = await findDuplicates(makeCandidate(), existingSources, [rejection], false);
    expect(matches.some((m) => m.matchType === "previously-rejected")).toBe(true);
  });
});

describe("taxonomy reuse", () => {
  it("collects unique existing taxonomy paths", () => {
    expect(getExistingTaxonomyPaths(existingSources)).toEqual([["AI Agent Tooling", "MCP Servers"]]);
  });

  it("reuses a known path without spending run budget", () => {
    const budget = new TaxonomyBudget(getExistingTaxonomyPaths(existingSources), 0);
    const result = budget.resolve(["AI Agent Tooling", "MCP Servers"]);
    expect(result).toEqual({
      path: ["AI Agent Tooling", "MCP Servers"],
      introducedNewPath: false,
      limited: false,
    });
  });

  it("falls back to an existing parent once the new-path budget is exhausted", () => {
    const budget = new TaxonomyBudget(getExistingTaxonomyPaths(existingSources), 0);
    const result = budget.resolve(["AI Agent Tooling", "Brand New Category"]);
    expect(result.limited).toBe(true);
    expect(result.path).toEqual(["AI Agent Tooling"]);
  });

  it("allows exactly maxNewPathsPerRun new paths before limiting further ones", () => {
    const budget = new TaxonomyBudget([], 1);
    const first = budget.resolve(["Sector A", "Cat"]);
    const second = budget.resolve(["Sector B", "Cat"]);
    expect(first.limited).toBe(false);
    expect(second.limited).toBe(true);
  });
});

describe("tag normalization and reuse", () => {
  it("normalizes case and punctuation to lowercase kebab-case", () => {
    expect(normalizeTag("MCP Server!!")).toBe("mcp-server");
  });

  it("collects existing tags", () => {
    expect(getExistingTags(existingSources)).toEqual(["mcp-server", "typescript"]);
  });

  it("prefers reused tags and drops generic filler when capping", () => {
    const capped = normalizeAndCapTags(["tool", "MCP-Server", "brand-new-tag"], ["mcp-server"], 2);
    expect(capped).toEqual(["mcp-server", "brand-new-tag"]);
  });

  it("stops introducing new tags once the per-run budget is spent", () => {
    const budget = new TagBudget(["mcp-server"], 1);
    const first = budget.apply(["mcp-server", "new-tag-a"]);
    const second = budget.apply(["mcp-server", "new-tag-b"]);
    expect(first.limited).toBe(false);
    expect(second.tags).toEqual(["mcp-server"]);
    expect(second.limited).toBe(true);
  });
});
