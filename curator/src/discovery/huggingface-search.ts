import type { Candidate } from "../types.js";
import type { PlatformSearchOptions, PlatformSearchResult } from "./platform.js";

const HUGGINGFACE_API = "https://huggingface.co/api";

interface HuggingFaceItem {
  id: string;
  likes: number;
  downloads: number | null;
  tags: string[];
  createdAt: string | null;
  lastModified: string | null;
  private: boolean;
  disabled: boolean | null;
}

function extractLicense(tags: string[]): string | null {
  const licenseTag = tags.find((tag) => tag.startsWith("license:"));
  return licenseTag ? licenseTag.slice("license:".length) : null;
}

function itemToCandidate(
  item: HuggingFaceItem,
  kind: "models" | "spaces",
  discoveryMethod: string,
): Candidate {
  const canonicalUrl =
    kind === "models" ? `https://huggingface.co/${item.id}` : `https://huggingface.co/spaces/${item.id}`;
  const parts = item.id.split("/");
  const owner = parts.length > 1 ? parts[0]! : null;
  const repo = parts.length > 1 ? parts.slice(1).join("/") : item.id;

  return {
    canonicalUrl,
    provider: "huggingface.co",
    owner,
    repo,
    title: item.id,
    // The list endpoint doesn't return a free-text description (only card
    // metadata via a separate per-item fetch, which we skip to keep
    // discovery cheap) — classification still has the id, tags, and likes.
    description: "",
    // `likes` is Hugging Face's popularity signal, used here as a stars
    // analog for ranking/threshold purposes; it is not a GitHub star count.
    stars: item.likes ?? 0,
    forks: 0,
    license: extractLicense(item.tags ?? []),
    primaryLanguage: null,
    topics: item.tags ?? [],
    createdAt: item.createdAt,
    lastPushAt: item.lastModified,
    archived: Boolean(item.disabled) || item.private,
    isFork: false,
    defaultBranch: null,
    homepage: null,
    discoveryMethod,
    discoveredAt: new Date().toISOString(),
    githubId: null,
    parentCanonicalUrl: null,
  };
}

async function searchKind(
  kind: "models" | "spaces",
  options: PlatformSearchOptions,
): Promise<PlatformSearchResult> {
  const params = new URLSearchParams({
    search: options.query,
    sort: "likes",
    direction: "-1",
    limit: String(options.perPage),
  });

  let response: Response;
  try {
    response = await fetch(`${HUGGINGFACE_API}/${kind}?${params.toString()}`, {
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

  const items = (await response.json()) as HuggingFaceItem[];
  return {
    candidates: items
      .filter((item) => !item.private)
      .map((item) => itemToCandidate(item, kind, options.discoveryMethod)),
    rateLimited: false,
  };
}

/** Searches Hugging Face's model hub — a real, unauthenticated public API, no invented data. */
export async function searchHuggingFaceModels(
  options: PlatformSearchOptions,
): Promise<PlatformSearchResult> {
  return searchKind("models", options);
}

/** Searches Hugging Face Spaces (deployed demos/apps) via the same public API shape. */
export async function searchHuggingFaceSpaces(
  options: PlatformSearchOptions,
): Promise<PlatformSearchResult> {
  return searchKind("spaces", options);
}
