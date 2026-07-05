import { describe, expect, it } from "vitest";
import { insertSource } from "../src/insertion/insert.js";
import type { Candidate, Classification } from "../src/types.js";

const candidate: Candidate = {
  canonicalUrl: "https://github.com/testowner/testrepo",
  provider: "github.com",
  owner: "testowner",
  repo: "testrepo",
  title: "testrepo",
  description: "",
  stars: 100,
  forks: 0,
  license: "MIT",
  primaryLanguage: "TypeScript",
  topics: [],
  createdAt: null,
  lastPushAt: null,
  archived: false,
  isFork: false,
  defaultBranch: "main",
  homepage: null,
  discoveryMethod: "test",
  discoveredAt: new Date().toISOString(),
  githubId: 1,
  parentCanonicalUrl: null,
};

function makeClassification(overrides: Partial<Classification> = {}): Classification {
  return {
    canonicalUrl: candidate.canonicalUrl,
    title: "testrepo",
    description: "A factual description.",
    taxonomyPath: ["AI Agent Tooling", "MCP Servers"],
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

describe("insertion (dry-run and idempotency safety)", () => {
  it("dry-run never invokes add-source.js and reports success without a sourceId", async () => {
    const result = await insertSource(candidate, makeClassification(), true);
    expect(result.succeeded).toBe(true);
    expect(result.sourceId).toBeNull();
  });

  it("refuses to insert when a field could corrupt add-source.js's argv parsing", async () => {
    const result = await insertSource(candidate, makeClassification({ title: "--url" }), false);
    expect(result.succeeded).toBe(false);
    expect(result.error).toMatch(/Refused to insert/);
  });

  it("refuses to insert when a taxonomy segment contains the '>' path separator", async () => {
    const result = await insertSource(
      candidate,
      makeClassification({ taxonomyPath: ["AI Agent Tooling", "A > B"] }),
      false,
    );
    expect(result.succeeded).toBe(false);
  });

  it("refuses to insert when a tag contains a comma (would corrupt --tags splitting)", async () => {
    const result = await insertSource(candidate, makeClassification({ tags: ["mcp-server,extra"] }), false);
    expect(result.succeeded).toBe(false);
  });
});
