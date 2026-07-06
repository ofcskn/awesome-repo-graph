import type { CuratorConfig } from "../config.js";
import type { Candidate } from "../types.js";
import { searchGitHubRepositories } from "./github-search.js";
import { searchGitLabRepositories } from "./gitlab-search.js";
import { searchHuggingFaceModels, searchHuggingFaceSpaces } from "./huggingface-search.js";
import { searchNpmPackages } from "./npm-search.js";
import type { PlatformSearchFn } from "./platform.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DiscoveryResult {
  candidates: Candidate[];
  queriesRun: string[];
  rateLimitedQueries: string[];
  /** Count of unique candidates contributed by each platform, for run reports. */
  platformCounts: Record<string, number>;
}

interface QueryJob {
  platform: string;
  query: string;
  search: PlatformSearchFn;
}

/**
 * Builds the full list of discovery jobs across every enabled platform
 * (GitHub search + topics, GitLab, Hugging Face models/spaces, npm), so a
 * single run never depends on GitHub alone for new candidates. Jobs from
 * different platforms are interleaved (not appended platform-by-platform)
 * for the same reason queries were interleaved within GitHub: a platform
 * that returns more per-query would otherwise crowd out the platforms
 * listed after it once the daily budget is reached.
 */
function buildQueryJobs(config: CuratorConfig): QueryJob[] {
  const githubQueries = Array.from(
    new Set([
      ...config.discovery.searchQueries,
      ...config.discovery.githubTopics.map((topic) => `topic:${topic}`),
    ]),
  );

  const lanes: QueryJob[][] = [
    githubQueries.map((query) => ({ platform: "github", query, search: searchGitHubRepositories })),
  ];

  if (config.discovery.platforms.gitlab.enabled) {
    lanes.push(
      config.discovery.platforms.gitlab.searchQueries.map((query) => ({
        platform: "gitlab",
        query,
        search: searchGitLabRepositories,
      })),
    );
  }
  if (config.discovery.platforms.huggingface.enabled) {
    lanes.push(
      config.discovery.platforms.huggingface.searchQueries.map((query) => ({
        platform: "huggingface",
        query,
        search: searchHuggingFaceModels,
      })),
    );
    lanes.push(
      config.discovery.platforms.huggingface.searchQueries.map((query) => ({
        platform: "huggingface",
        query,
        search: searchHuggingFaceSpaces,
      })),
    );
  }
  if (config.discovery.platforms.npm.enabled) {
    lanes.push(
      config.discovery.platforms.npm.searchQueries.map((query) => ({
        platform: "npm",
        query,
        search: searchNpmPackages,
      })),
    );
  }

  const jobs: QueryJob[] = [];
  const maxLaneLength = Math.max(...lanes.map((lane) => lane.length));
  for (let i = 0; i < maxLaneLength; i += 1) {
    for (const lane of lanes) {
      if (lane[i]) jobs.push(lane[i]!);
    }
  }
  return jobs;
}

/**
 * Multi-platform, multi-stage discovery: runs each configured search query
 * across every enabled platform, dedupes within the batch by canonical URL,
 * and stops once config.discovery.dailyCandidateLimit is reached. Spaces
 * GitHub requests out to stay under GitHub's unauthenticated search rate
 * limit (10 requests/minute); other platforms' public search endpoints
 * don't share that constraint, so only GitHub jobs are throttled.
 *
 * Each job only requests its fair share of the *remaining* budget
 * (remaining candidates / remaining jobs, recomputed every iteration) —
 * without this, a single popular query/platform early in the list would
 * fill the entire dailyCandidateLimit by itself and starve everything
 * listed after it, which defeats the point of discovering from more than
 * one source.
 */
export async function discoverCandidates(config: CuratorConfig): Promise<DiscoveryResult> {
  const jobs = buildQueryJobs(config);

  const seen = new Map<string, Candidate>();
  const queriesRun: string[] = [];
  const rateLimitedQueries: string[] = [];
  const platformCounts: Record<string, number> = {};

  for (let i = 0; i < jobs.length; i += 1) {
    const remainingBudget = config.discovery.dailyCandidateLimit - seen.size;
    if (remainingBudget <= 0) break;
    const remainingJobs = jobs.length - i;
    const perJobShare = Math.ceil(remainingBudget / remainingJobs);
    const job = jobs[i]!;
    const label = `${job.platform}:${job.query}`;

    const { candidates, rateLimited } = await job.search({
      query: job.query,
      perPage: Math.min(30, perJobShare),
      discoveryMethod: `${job.platform}-search:${job.query}`,
    });
    queriesRun.push(label);
    if (rateLimited) {
      rateLimitedQueries.push(label);
    } else {
      for (const candidate of candidates) {
        if (seen.size >= config.discovery.dailyCandidateLimit) break;
        if (!seen.has(candidate.canonicalUrl)) {
          seen.set(candidate.canonicalUrl, candidate);
          platformCounts[job.platform] = (platformCounts[job.platform] ?? 0) + 1;
        }
      }
    }

    const hasMoreWork = i < jobs.length - 1 && seen.size < config.discovery.dailyCandidateLimit;
    if (hasMoreWork && job.platform === "github") {
      // Stay comfortably under GitHub's 10 req/min unauthenticated search limit.
      await sleep(6500);
    }
  }

  return {
    candidates: Array.from(seen.values()),
    queriesRun,
    rateLimitedQueries,
    platformCounts,
  };
}
