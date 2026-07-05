import type { CuratorConfig } from "../config.js";
import type { Candidate } from "../types.js";
import { searchGitHubRepositories } from "./github-search.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DiscoveryResult {
  candidates: Candidate[];
  queriesRun: string[];
  rateLimitedQueries: string[];
}

/**
 * Multi-stage discovery: runs each configured search query and GitHub topic
 * against the public search API, dedupes within the batch by canonical URL,
 * and stops once config.discovery.dailyCandidateLimit is reached. Spaces
 * requests out to stay under GitHub's unauthenticated search rate limit
 * (10 requests/minute).
 */
export async function discoverCandidates(config: CuratorConfig): Promise<DiscoveryResult> {
  const queries = Array.from(
    new Set([
      ...config.discovery.searchQueries,
      ...config.discovery.githubTopics.map((topic) => `topic:${topic}`),
    ]),
  );

  const seen = new Map<string, Candidate>();
  const queriesRun: string[] = [];
  const rateLimitedQueries: string[] = [];

  for (let i = 0; i < queries.length; i += 1) {
    if (seen.size >= config.discovery.dailyCandidateLimit) break;
    const query = queries[i]!;

    const { candidates, rateLimited } = await searchGitHubRepositories({
      query,
      perPage: Math.min(30, config.discovery.dailyCandidateLimit),
      discoveryMethod: `github-search:${query}`,
    });
    queriesRun.push(query);
    if (rateLimited) {
      rateLimitedQueries.push(query);
    } else {
      for (const candidate of candidates) {
        if (seen.size >= config.discovery.dailyCandidateLimit) break;
        if (!seen.has(candidate.canonicalUrl)) {
          seen.set(candidate.canonicalUrl, candidate);
        }
      }
    }

    const hasMoreWork = i < queries.length - 1 && seen.size < config.discovery.dailyCandidateLimit;
    if (hasMoreWork) {
      // Stay comfortably under GitHub's 10 req/min unauthenticated search limit.
      await sleep(6500);
    }
  }

  return {
    candidates: Array.from(seen.values()),
    queriesRun,
    rateLimitedQueries,
  };
}
