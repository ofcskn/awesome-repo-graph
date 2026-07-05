import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCandidates } from "../src/discovery/index.js";
import { loadConfig } from "../src/config.js";

describe("discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns no candidates when GitHub search yields nothing (empty-result behavior)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
    );
    const { config } = loadConfig({});
    const smallConfig = {
      ...config,
      discovery: {
        ...config.discovery,
        searchQueries: ["topic:nonexistent-xyz"],
        githubTopics: [],
        dailyCandidateLimit: 5,
      },
    };
    const result = await discoverCandidates(smallConfig);
    expect(result.candidates).toEqual([]);
  });

  it("normalizes a GitHub search hit into a Candidate without inventing any fields", async () => {
    const item = {
      id: 42,
      full_name: "o/r",
      owner: { login: "o" },
      name: "r",
      html_url: "https://github.com/o/r",
      description: "desc",
      stargazers_count: 10,
      forks_count: 2,
      license: { spdx_id: "MIT" },
      language: "TypeScript",
      topics: ["ai-agent"],
      created_at: "2024-01-01T00:00:00Z",
      pushed_at: "2026-06-01T00:00:00Z",
      archived: false,
      fork: false,
      default_branch: "main",
      homepage: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [item] }), { status: 200 })),
    );
    const { config } = loadConfig({});
    const smallConfig = {
      ...config,
      discovery: { ...config.discovery, searchQueries: ["topic:ai-agent"], githubTopics: [], dailyCandidateLimit: 5 },
    };
    const result = await discoverCandidates(smallConfig);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.canonicalUrl).toBe("https://github.com/o/r");
    expect(result.candidates[0]?.githubId).toBe(42);
  });

  it("gives every configured query a fair share of the budget instead of letting the first exhaust it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        const perPage = Number(parsed.searchParams.get("per_page"));
        const q = parsed.searchParams.get("q") ?? "q";
        const items = Array.from({ length: perPage }, (_, i) => ({
          id: i + q.length,
          full_name: `${q}/r${i}`,
          owner: { login: q },
          name: `r${i}`,
          html_url: `https://github.com/${q}/r${i}`,
          description: "",
          stargazers_count: 10,
          forks_count: 0,
          license: null,
          language: null,
          topics: [],
          created_at: "2024-01-01T00:00:00Z",
          pushed_at: "2026-06-01T00:00:00Z",
          archived: false,
          fork: false,
          default_branch: "main",
          homepage: null,
        }));
        return new Response(JSON.stringify({ items }), { status: 200 });
      }),
    );
    const { config } = loadConfig({});
    const smallConfig = {
      ...config,
      discovery: {
        ...config.discovery,
        searchQueries: ["topic:a", "topic:b", "topic:c"],
        githubTopics: [],
        dailyCandidateLimit: 3,
      },
    };
    const resultPromise = discoverCandidates(smallConfig);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result.queriesRun).toEqual(["topic:a", "topic:b", "topic:c"]);
    expect(result.candidates).toHaveLength(3);
  });

  it("marks a query rate-limited (403/429) instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    const { config } = loadConfig({});
    const smallConfig = {
      ...config,
      discovery: { ...config.discovery, searchQueries: ["topic:x"], githubTopics: [], dailyCandidateLimit: 5 },
    };
    const result = await discoverCandidates(smallConfig);
    expect(result.rateLimitedQueries).toEqual(["topic:x"]);
    expect(result.candidates).toEqual([]);
  });
});
