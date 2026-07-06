import type { Candidate } from "../types.js";
import type { PlatformSearchOptions, PlatformSearchResult } from "./platform.js";

const NPM_REGISTRY_API = "https://registry.npmjs.org/-/v1/search";

interface NpmSearchObject {
  package: {
    name: string;
    description: string | null;
    keywords: string[] | null;
    date: string | null;
    license: string | null;
    links: { npm?: string; homepage?: string; repository?: string };
  };
  score: { detail: { popularity: number } };
}

interface NpmSearchResponse {
  objects: NpmSearchObject[];
}

/**
 * npm's public registry search needs no token. There's no GitHub-style star
 * count for a package, so `score.detail.popularity` (0-1, npm's own ranking
 * signal blending download trend and dependents) is scaled onto the `stars`
 * field as a documented proxy — used for relative ranking/thresholds only,
 * never presented as a literal star count.
 */
export async function searchNpmPackages(
  options: PlatformSearchOptions,
): Promise<PlatformSearchResult> {
  const params = new URLSearchParams({
    text: options.query,
    size: String(options.perPage),
  });

  let response: Response;
  try {
    response = await fetch(`${NPM_REGISTRY_API}?${params.toString()}`, {
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

  const data = (await response.json()) as NpmSearchResponse;
  const candidates: Candidate[] = data.objects.map(({ package: pkg, score }) => ({
    canonicalUrl: pkg.links.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
    provider: "npmjs.com",
    owner: null,
    repo: null,
    title: pkg.name,
    description: pkg.description ?? "",
    stars: Math.round((score.detail.popularity ?? 0) * 1000),
    forks: 0,
    license: pkg.license ?? null,
    primaryLanguage: "JavaScript",
    topics: pkg.keywords ?? [],
    // The registry only reports the latest publish date, not the package's
    // original creation date — used for both fields as the closest available
    // activity signal.
    createdAt: pkg.date,
    lastPushAt: pkg.date,
    archived: false,
    isFork: false,
    defaultBranch: null,
    homepage: pkg.links.homepage ?? null,
    discoveryMethod: options.discoveryMethod,
    discoveredAt: new Date().toISOString(),
    githubId: null,
    parentCanonicalUrl: null,
  }));

  return { candidates, rateLimited: false };
}
