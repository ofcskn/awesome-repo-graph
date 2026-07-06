import type { Candidate } from "../types.js";

/**
 * Shared shape every discovery backend implements (github-search.ts,
 * gitlab-search.ts, huggingface-search.ts, npm-search.ts) so discovery/index.ts
 * can fan a query list out across all enabled platforms identically instead
 * of special-casing GitHub. Keeping discovery multi-platform is a deliberate
 * policy: a catalog that only ever discovers from GitHub search systematically
 * misses projects that live on GitLab, model/space hubs, or language package
 * registries.
 */
export interface PlatformSearchOptions {
  query: string;
  perPage: number;
  discoveryMethod: string;
}

export interface PlatformSearchResult {
  candidates: Candidate[];
  rateLimited: boolean;
}

export type PlatformSearchFn = (options: PlatformSearchOptions) => Promise<PlatformSearchResult>;

export type PlatformName = "github" | "gitlab" | "huggingface" | "npm";
