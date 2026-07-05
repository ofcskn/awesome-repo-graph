import type { CuratorConfig } from "../config.js";
import type { Candidate, MechanicalValidationResult, RejectionReasonCode } from "../types.js";

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

function matchesExcludedKeyword(candidate: Candidate, keywords: string[]): boolean {
  const haystack = `${candidate.title} ${candidate.description}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

/**
 * A live reachability check as defense-in-depth: discovery already came
 * from a real GitHub API response, but a repo can be deleted/privated in
 * the (short) window between discovery and validation within the same run.
 */
export async function verifyUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Mechanical (non-AI) validation gates from the spec's CANDIDATE VALIDATION
 * section, items 1-3 (reachability), 5-9 (policy thresholds), and the
 * excluded owner/repo/keyword lists from config.quality. Content-quality
 * judgments (spam/placeholder detection, query-relevance matching — items
 * 10-11, 17) are intentionally deferred to AI classification, which is
 * better suited to that kind of semantic judgment than string heuristics.
 */
export function mechanicalValidate(
  candidate: Candidate,
  config: CuratorConfig,
  reachable: boolean,
): MechanicalValidationResult {
  const reasons: RejectionReasonCode[] = [];
  const { quality } = config;

  if (!reachable) {
    reasons.push("url-unresolvable");
  }
  if (candidate.archived && !quality.allowArchived) {
    reasons.push("archived-disallowed");
  }
  if (candidate.isFork && !quality.allowForks) {
    reasons.push("fork-disallowed");
  }
  if (candidate.stars < quality.minStars) {
    reasons.push("below-min-stars");
  }

  const ageDays = daysSince(candidate.createdAt);
  if (ageDays !== null && ageDays < quality.minRepoAgeDays) {
    reasons.push("too-young");
  }

  const inactivityDays = daysSince(candidate.lastPushAt);
  if (inactivityDays !== null && inactivityDays > quality.maxInactivityDays) {
    reasons.push("inactive");
  }

  if (candidate.license) {
    if (quality.licenseDenylist.includes(candidate.license)) {
      reasons.push("license-denied");
    } else if (
      quality.licenseAllowlist.length > 0 &&
      !quality.licenseAllowlist.includes(candidate.license)
    ) {
      reasons.push("license-not-allowlisted");
    }
  }

  if (candidate.owner && quality.excludedOwners.includes(candidate.owner)) {
    reasons.push("excluded-owner");
  }
  const fullName = candidate.owner && candidate.repo ? `${candidate.owner}/${candidate.repo}` : null;
  if (fullName && quality.excludedRepos.includes(fullName)) {
    reasons.push("excluded-repo");
  }
  if (matchesExcludedKeyword(candidate, quality.excludedKeywords)) {
    reasons.push("excluded-keyword");
  }

  return {
    candidate,
    passed: reasons.length === 0,
    reasons,
  };
}
