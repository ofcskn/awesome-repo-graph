import type { CuratorConfig } from "../config.js";
import type { Candidate, Classification, ExistingSourceSummary, ProviderName } from "../types.js";

export interface ClassifyRequest {
  candidate: Candidate;
  existingTaxonomyPaths: string[][];
  existingTags: string[];
  existingSources: ExistingSourceSummary[];
  config: CuratorConfig;
}

export interface ClassifyOutcome {
  classification: Classification;
  attempts: number;
  latencyMs: number;
  /** Approximate token usage, when the SDK reports it — used for cost accounting only. */
  totalTokens: number | null;
}

export interface AIProvider {
  readonly name: ProviderName;
  /** True only when required credentials/config are present — checked before use. */
  isConfigured(): boolean;
  classify(request: ClassifyRequest): Promise<ClassifyOutcome>;
}

export class ProviderConfigurationError extends Error {
  constructor(provider: ProviderName, reason: string) {
    super(`Provider "${provider}" is not configured: ${reason}`);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderResponseValidationError extends Error {
  constructor(provider: ProviderName, reason: string) {
    super(`Provider "${provider}" returned an invalid structured response: ${reason}`);
    this.name = "ProviderResponseValidationError";
  }
}

/** Strips anything that could leak a secret before an error reaches a report/log. */
export function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(sk-|key-)[A-Za-z0-9_-]{6,}/g, "$1••••••");
}
