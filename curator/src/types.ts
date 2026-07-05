import type { ProviderName } from "./env.js";

export type { ProviderName };

/**
 * Normalized discovery record. Every field here must be backed by a real
 * network response (GitHub API, etc.) — never invented by an AI model.
 */
export interface Candidate {
  canonicalUrl: string;
  provider: "github.com" | string;
  owner: string | null;
  repo: string | null;
  title: string;
  description: string;
  stars: number;
  forks: number;
  license: string | null;
  primaryLanguage: string | null;
  topics: string[];
  createdAt: string | null;
  lastPushAt: string | null;
  archived: boolean;
  isFork: boolean;
  defaultBranch: string | null;
  homepage: string | null;
  discoveryMethod: string;
  discoveredAt: string;
  /** GitHub's numeric repo id, when known — used for rename-proof dedup. */
  githubId: number | null;
  /** Populated only when isFork; used for fork/parent dedup. */
  parentCanonicalUrl: string | null;
}

export type RejectionReasonCode =
  | "url-unresolvable"
  | "private-or-missing"
  | "redirects-unrelated"
  | "archived-disallowed"
  | "fork-disallowed"
  | "below-min-stars"
  | "too-young"
  | "inactive"
  | "license-denied"
  | "license-not-allowlisted"
  | "off-topic"
  | "spam-or-placeholder"
  | "duplicate-of-existing"
  | "renamed-duplicate"
  | "fork-of-existing-source"
  | "same-project-alt-url"
  | "recently-evaluated"
  | "insufficient-evidence"
  | "excluded-owner"
  | "excluded-repo"
  | "excluded-keyword"
  | "low-quality-score"
  | "low-confidence"
  | "below-consensus-threshold"
  | "insertion-failed"
  | "provider-error"
  | "taxonomy-path-limit-exceeded"
  | "tag-limit-exceeded";

export interface MechanicalValidationResult {
  candidate: Candidate;
  passed: boolean;
  reasons: RejectionReasonCode[];
}

export interface DuplicateMatch {
  candidateUrl: string;
  existingSourceId: string;
  matchType:
    | "exact-url"
    | "owner-repo"
    | "redirect-canonical"
    | "github-id"
    | "fork-parent"
    | "mirror"
    | "homepage-similarity"
    | "title-similarity"
    | "semantic-near-duplicate"
    | "previously-rejected";
  confidence: number;
}

/**
 * AI-produced structured classification. All four score fields use a fixed
 * 0-100 scale; `confidenceScore` uses 0-1 (matching config.quality.minClassificationConfidence).
 */
export interface Classification {
  canonicalUrl: string;
  title: string;
  description: string;
  taxonomyPath: string[];
  tags: string[];
  qualityScore: number;
  relevanceScore: number;
  maintenanceScore: number;
  uniquenessScore: number;
  confidenceScore: number;
  accepted: boolean;
  rejectionReasons: string[];
  evidence: string[];
  relatedExistingSourceIds: string[];
}

export interface ProviderClassification {
  provider: ProviderName;
  classification: Classification | null;
  error: string | null;
  attempts: number;
  latencyMs: number;
}

export interface ConsensusResult {
  candidate: Candidate;
  perProvider: ProviderClassification[];
  finalClassification: Classification | null;
  finalConfidence: number;
  accepted: boolean;
  deferred: boolean;
  disagreements: string[];
  rejectionReasons: RejectionReasonCode[];
}

export interface RejectionRecord {
  canonicalUrl: string;
  githubId: number | null;
  evaluatedAt: string;
  reasonCode: RejectionReasonCode;
  metadataFingerprint: string;
  reconsiderAt: string | null;
}

export interface InsertionResult {
  candidate: Candidate;
  classification: Classification;
  succeeded: boolean;
  sourceId: string | null;
  error: string | null;
}

export interface ExistingSourceSummary {
  id: string;
  url: string;
  path: string[];
  tags: string[];
}
