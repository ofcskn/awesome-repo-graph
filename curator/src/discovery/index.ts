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
 *
 * Each query only requests its fair share of the *remaining* budget
 * (remaining candidates / remaining queries, recomputed every iteration) —
 * without this, a single popular query early in the list (e.g. an
 * established topic with thousands of matches) would fill the entire
 * dailyCandidateLimit by itself and starve every query listed after it,
 * which defeats the point of configuring a diverse query list. A query
 * that returns fewer than its share simply leaves the surplus for the
 * next one.
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
    const remainingBudget = config.discovery.dailyCandidateLimit - seen.size;
    if (remainingBudget <= 0) break;
    const remainingQueries = queries.length - i;
    const perQueryShare = Math.ceil(remainingBudget / remainingQueries);
    const query = queries[i]!;

    const { candidates, rateLimited } = await searchGitHubRepositories({
      query,
      perPage: Math.min(30, perQueryShare),
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
