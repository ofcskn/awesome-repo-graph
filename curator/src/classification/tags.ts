import type { StoredSource } from "../store-bridge.js";

const FILLER_TAGS = new Set(["tool", "project", "awesome", "repository", "repo", "library"]);

export function getExistingTags(sources: StoredSource[]): string[] {
  const tags = new Set<string>();
  for (const source of sources) {
    for (const tag of source.tags) tags.add(tag);
  }
  return Array.from(tags).sort();
}

export function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalizes proposed tags, drops generic filler, dedupes, and caps at
 * config.taxonomy.maxTagsPerSource — preferring tags that already exist in
 * the catalog over brand-new ones when a cut has to be made.
 */
export function normalizeAndCapTags(proposedTags: string[], existingTags: string[], maxTagsPerSource: number): string[] {
  const existingSet = new Set(existingTags);
  const normalized = Array.from(
    new Set(
      proposedTags
        .map(normalizeTag)
        .filter((tag) => tag.length > 0 && !FILLER_TAGS.has(tag)),
    ),
  );

  const reused = normalized.filter((tag) => existingSet.has(tag));
  const fresh = normalized.filter((tag) => !existingSet.has(tag));

  return [...reused, ...fresh].slice(0, maxTagsPerSource);
}

/**
 * Enforces config.taxonomy.maxNewTagsPerRun across an entire run: once the
 * per-run new-tag budget is exhausted, further genuinely-new tags are
 * dropped from a candidate's tag list (its already-reused tags are kept).
 */
export class TagBudget {
  private newTagsIntroduced = new Set<string>();

  constructor(
    private readonly existingTags: string[],
    private readonly maxNewTagsPerRun: number,
  ) {}

  apply(tags: string[]): { tags: string[]; limited: boolean } {
    const existingSet = new Set(this.existingTags);
    const result: string[] = [];
    let limited = false;

    for (const tag of tags) {
      if (existingSet.has(tag) || this.newTagsIntroduced.has(tag)) {
        result.push(tag);
        continue;
      }
      if (this.newTagsIntroduced.size < this.maxNewTagsPerRun) {
        this.newTagsIntroduced.add(tag);
        result.push(tag);
      } else {
        limited = true;
      }
    }

    return { tags: result, limited };
  }

  introducedCount(): number {
    return this.newTagsIntroduced.size;
  }
}
