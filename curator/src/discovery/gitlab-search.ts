import type { Candidate } from "../types.js";
import type { PlatformSearchOptions, PlatformSearchResult } from "./platform.js";

const GITLAB_API = "https://gitlab.com/api/v4";

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  description: string | null;
  star_count: number;
  forks_count: number;
  license: { nickname: string | null; name: string | null } | null;
  topics: string[];
  created_at: string;
  last_activity_at: string;
  archived: boolean;
  default_branch: string | null;
  forked_from_project: { web_url: string } | null;
}

/**
 * GitLab.com's public REST API needs no token for public project search
 * (same unauthenticated posture as the GitHub search backend). `license=true`
 * asks GitLab to include license metadata in the response for projects that
 * have one; it's silently ignored (not an error) for projects that don't.
 */
export async function searchGitLabRepositories(
  options: PlatformSearchOptions,
): Promise<PlatformSearchResult> {
  const params = new URLSearchParams({
    search: options.query,
    order_by: "star_count",
    sort: "desc",
    per_page: String(options.perPage),
    license: "true",
  });

  let response: Response;
  try {
    response = await fetch(`${GITLAB_API}/projects?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "awesome-repo-graph-curator" },
    });
  } catch {
    return { candidates: [], rateLimited: false };
  }

  if (response.status === 403 || response.status === 429) {
    return { candidates: [], rateLimited: true };
  }
  if (!response.ok) {
    return { candidates: [], rateLimited: false };
  }

  const items = (await response.json()) as GitLabProject[];
  const candidates: Candidate[] = items.map((item) => {
    const parts = item.path_with_namespace.split("/");
    const repo = parts.pop() ?? item.name;
    const owner = parts.join("/") || null;
    return {
      canonicalUrl: item.web_url,
      provider: "gitlab.com",
      owner,
      repo,
      title: item.name,
      description: item.description ?? "",
      stars: item.star_count,
      forks: item.forks_count,
      license: item.license?.nickname ?? item.license?.name ?? null,
      primaryLanguage: null,
      topics: item.topics ?? [],
      createdAt: item.created_at,
      lastPushAt: item.last_activity_at,
      archived: item.archived,
      isFork: Boolean(item.forked_from_project),
      defaultBranch: item.default_branch,
      homepage: null,
      discoveryMethod: options.discoveryMethod,
      discoveredAt: new Date().toISOString(),
      githubId: null,
      parentCanonicalUrl: item.forked_from_project?.web_url ?? null,
    };
  });

  return { candidates, rateLimited: false };
}
