import { fetchForkParentUrl } from "../discovery/github-search.js";
import { findDuplicateSource, normalizeSourceUrl, type StoredSource } from "../store-bridge.js";
import { cosineSimilarity } from "../embeddings/similarity.js";
import type { Candidate, DuplicateMatch, RejectionRecord } from "../types.js";

export interface EmbeddingDuplicateContext {
  candidateEmbedding: number[];
  existingEmbeddings: { sourceId: string; vector: number[] }[];
  threshold: number;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;
  return shared / Math.max(wordsA.size, wordsB.size);
}

function normalizeHomepage(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Runs every deduplication layer from the spec's DEDUPLICATION section
 * against a single candidate. Exact-URL matching reuses
 * scripts/lib/store.js's own normalizeUrl/findDuplicate so we can never
 * disagree with scripts/add-source.js about what counts as a duplicate.
 */
export async function findDuplicates(
  candidate: Candidate,
  existingSources: StoredSource[],
  rejectionHistory: RejectionRecord[],
  allowForksConsidered: boolean,
  embeddingContext: EmbeddingDuplicateContext | null = null,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  // 1-2. Exact / case-insensitive normalized URL match (delegates to store.js).
  const exact = findDuplicateSource(existingSources, candidate.canonicalUrl);
  if (exact) {
    matches.push({
      candidateUrl: candidate.canonicalUrl,
      existingSourceId: exact.id,
      matchType: "exact-url",
      confidence: 1,
    });
    return matches; // no need to check further layers once an exact hit is found
  }

  // 3. Owner+repo redirect-aware canonical match: GitHub renames a repo but
  // old owner/repo slugs in our catalog would no longer normalize the same
  // way as the live URL, so compare owner/repo pairs directly too.
  if (candidate.owner && candidate.repo) {
    const ownerRepo = `${candidate.owner.toLowerCase()}/${candidate.repo.toLowerCase()}`;
    const renamed = existingSources.find(
      (s) => s.owner && s.repo && `${s.owner.toLowerCase()}/${s.repo.toLowerCase()}` === ownerRepo,
    );
    if (renamed) {
      matches.push({
        candidateUrl: candidate.canonicalUrl,
        existingSourceId: renamed.id,
        matchType: "owner-repo",
        confidence: 1,
      });
    }
  }

  // 5-6. Fork/parent matching: if this candidate is a fork of something we
  // already track, or an existing source is itself a fork of this candidate.
  if (candidate.isFork && allowForksConsidered && candidate.owner && candidate.repo) {
    const parentUrl = await fetchForkParentUrl(candidate.owner, candidate.repo);
    if (parentUrl) {
      const parentMatch = existingSources.find(
        (s) => normalizeSourceUrl(s.url) === normalizeSourceUrl(parentUrl),
      );
      if (parentMatch) {
        matches.push({
          candidateUrl: candidate.canonicalUrl,
          existingSourceId: parentMatch.id,
          matchType: "fork-parent",
          confidence: 0.95,
        });
      }
    }
  }

  // 7. Homepage similarity (same project promoted under a different repo URL).
  const candidateHomepage = normalizeHomepage(candidate.homepage);
  if (candidateHomepage) {
    for (const source of existingSources) {
      // sources.json has no homepage field today, so we compare against the
      // source's own URL as a best-effort homepage proxy.
      if (normalizeHomepage(source.url) === candidateHomepage) {
        matches.push({
          candidateUrl: candidate.canonicalUrl,
          existingSourceId: source.id,
          matchType: "homepage-similarity",
          confidence: 0.8,
        });
      }
    }
  }

  // 8. Title similarity heuristic (word-overlap Jaccard) — a cheap
  // string-level check that runs regardless of whether embeddings are
  // configured.
  for (const source of existingSources) {
    const similarity = titleSimilarity(candidate.title, source.title);
    if (similarity >= 0.85) {
      matches.push({
        candidateUrl: candidate.canonicalUrl,
        existingSourceId: source.id,
        matchType: "title-similarity",
        confidence: similarity,
      });
    }
  }

  // 9. Semantic near-duplicate detection via the embedding memory (only
  // when an embedding provider is configured — see
  // curator/src/memory/embedding-store.ts). Flags two sources describing
  // the same project in different words, which the title/tag heuristics
  // above would miss.
  if (embeddingContext) {
    let best: { sourceId: string; score: number } | null = null;
    for (const existing of embeddingContext.existingEmbeddings) {
      const score = cosineSimilarity(embeddingContext.candidateEmbedding, existing.vector);
      if (!best || score > best.score) best = { sourceId: existing.sourceId, score };
    }
    if (best && best.score >= embeddingContext.threshold) {
      matches.push({
        candidateUrl: candidate.canonicalUrl,
        existingSourceId: best.sourceId,
        matchType: "semantic-near-duplicate",
        confidence: best.score,
      });
    }
  }

  // 10. Previously-rejected candidate history (see memory/rejection-store.ts
  // for the reconsideration rules that decide whether this should still block).
  const rejection = rejectionHistory.find((r) => r.canonicalUrl === candidate.canonicalUrl);
  if (rejection) {
    matches.push({
      candidateUrl: candidate.canonicalUrl,
      existingSourceId: rejection.reasonCode,
      matchType: "previously-rejected",
      confidence: 1,
    });
  }

  return matches;
}
