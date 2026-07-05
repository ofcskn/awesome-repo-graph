import type { StoredSource } from "../store-bridge.js";

export function getExistingTaxonomyPaths(sources: StoredSource[]): string[][] {
  const seen = new Map<string, string[]>();
  for (const source of sources) {
    seen.set(source.path.join(">"), source.path);
  }
  return Array.from(seen.values());
}

export function isKnownTaxonomyPath(existingPaths: string[][], path: string[]): boolean {
  const key = path.join(">");
  return existingPaths.some((p) => p.join(">") === key);
}

/**
 * Enforces config.taxonomy.maxNewPathsPerRun across an entire run. Call
 * once per candidate, in the order candidates are processed; candidates
 * beyond the per-run budget that would introduce a genuinely new path are
 * told to fall back to the closest existing parent path instead of being
 * silently allowed to keep multiplying the taxonomy.
 */
export class TaxonomyBudget {
  private newPathsIntroduced = new Set<string>();

  constructor(
    private readonly existingPaths: string[][],
    private readonly maxNewPathsPerRun: number,
  ) {}

  /**
   * Returns the path to actually use for this candidate: the proposed path
   * if it's already known or budget allows a new one, otherwise the
   * broadest matching existing prefix (or the proposed top-level sector
   * alone, if even that is new but budget is exhausted for anything deeper).
   */
  resolve(proposedPath: string[]): { path: string[]; introducedNewPath: boolean; limited: boolean } {
    if (isKnownTaxonomyPath(this.existingPaths, proposedPath)) {
      return { path: proposedPath, introducedNewPath: false, limited: false };
    }

    const key = proposedPath.join(">");
    const alreadyCountedThisRun = this.newPathsIntroduced.has(key);
    const budgetAvailable =
      alreadyCountedThisRun || this.newPathsIntroduced.size < this.maxNewPathsPerRun;

    if (budgetAvailable) {
      this.newPathsIntroduced.add(key);
      return { path: proposedPath, introducedNewPath: !alreadyCountedThisRun, limited: false };
    }

    // Budget exhausted: fall back to the longest existing prefix of the
    // proposed path, or its top-level sector if even the sector is new.
    for (let depth = proposedPath.length - 1; depth > 0; depth -= 1) {
      const prefix = proposedPath.slice(0, depth);
      if (isKnownTaxonomyPath(this.existingPaths, prefix)) {
        return { path: prefix, introducedNewPath: false, limited: true };
      }
    }
    const sectorOnly = [proposedPath[0]!];
    return { path: sectorOnly, introducedNewPath: false, limited: true };
  }

  introducedCount(): number {
    return this.newPathsIntroduced.size;
  }
}
