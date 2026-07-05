import { describe, expect, it } from "vitest";
import { buildClassificationPrompt } from "../src/providers/prompt.js";
import type { Candidate } from "../src/types.js";

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

describe("buildClassificationPrompt target categories", () => {
  it("renders '(none configured for this run)' when no target categories are given", () => {
    const { user } = buildClassificationPrompt(candidate, [], [], []);
    expect(user).toContain("Target categories for this run");
    expect(user).toContain("(none configured for this run)");
  });

  it("lists configured target categories in the user prompt", () => {
    const { user } = buildClassificationPrompt(candidate, [], [], [], [
      "Backend Engineering & APIs",
      "Web3 & Distributed Systems",
    ]);
    expect(user).toContain("- Backend Engineering & APIs");
    expect(user).toContain("- Web3 & Distributed Systems");
  });

  it("tells the model to prefer a genuinely-fitting target category over an unrelated existing path", () => {
    const { system } = buildClassificationPrompt(candidate, [], [], []);
    expect(system).toContain("target category");
    expect(system).toContain("don't force-fit");
  });
});
