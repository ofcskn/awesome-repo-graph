import type { Candidate } from "../types.js";

const GITHUB_API = "https://api.github.com";

interface GitHubSearchItem {
  id: number;
  full_name: string;
  owner: { login: string };
  name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  license: { spdx_id: string | null } | null;
  language: string | null;
  topics: string[];
  created_at: string;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  homepage: string | null;
}

interface GitHubSearchResponse {
  items: GitHubSearchItem[];
}

async function githubFetch(path: string): Promise<Response> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "awesome-repo-graph-curator",
    },
  });
  return response;
}

function itemToCandidate(item: GitHubSearchItem, discoveryMethod: string): Candidate {
  return {
    canonicalUrl: item.html_url,
    provider: "github.com",
    owner: item.owner.login,
    repo: item.name,
    title: item.name,
    description: item.description ?? "",
    stars: item.stargazers_count,
    forks: item.forks_count,
    license: item.license?.spdx_id ?? null,
    primaryLanguage: item.language,
    topics: item.topics ?? [],
    createdAt: item.created_at,
    lastPushAt: item.pushed_at,
    archived: item.archived,
    isFork: item.fork,
    defaultBranch: item.default_branch,
    homepage: item.homepage || null,
    discoveryMethod,
    discoveredAt: new Date().toISOString(),
    githubId: item.id,
    parentCanonicalUrl: null,
  };
}

/** Only fetched lazily for forks, and only when the config allows considering forks. */
export async function fetchForkParentUrl(owner: string, repo: string): Promise<string | null> {
  try {
    const response = await githubFetch(`/repos/${owner}/${repo}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { parent?: { html_url?: string } };
    return data.parent?.html_url ?? null;
  } catch {
    return null;
  }
}

export interface GitHubSearchOptions {
  query: string;
  perPage: number;
  discoveryMethod: string;
}

/**
 * Runs one GitHub code search query via the public, unauthenticated REST
 * API (consistent with scripts/add-source.js and scripts/refresh-scores.js,
 * which never send credentials to GitHub — see AGENTS.MD). Every candidate
 * returned here is a real search hit, never AI-invented.
 */
export async function searchGitHubRepositories(
  options: GitHubSearchOptions,
): Promise<{ candidates: Candidate[]; rateLimited: boolean }> {
  const params = new URLSearchParams({
    q: options.query,
    sort: "stars",
    order: "desc",
    per_page: String(options.perPage),
  });

  const response = await githubFetch(`/search/repositories?${params.toString()}`);

  if (response.status === 403 || response.status === 429) {
    return { candidates: [], rateLimited: true };
  }
  if (!response.ok) {
    return { candidates: [], rateLimited: false };
  }

  const data = (await response.json()) as GitHubSearchResponse;
  return {
    candidates: data.items.map((item) => itemToCandidate(item, options.discoveryMethod)),
    rateLimited: false,
  };
}
