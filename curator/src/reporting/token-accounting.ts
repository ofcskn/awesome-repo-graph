import type { ProviderName } from "../env.js";
import {
  DEFAULT_PRICE_TABLE,
  estimateCostUsd,
  ESTIMATE_BASIS,
  type EstimateBasis,
  type PriceTable,
} from "../pricing.js";

/**
 * Pipeline stages that consume provider tokens. `classification` totals are
 * aggregated from the per-call `totalTokens` the provider layer already
 * reports. `embeddings` is a first-class stage in the schema; its usage is
 * `null` until the embedding adapters surface SDK usage (see design doc).
 */
export type PipelineStage = "classification" | "embeddings";

export const PIPELINE_STAGES: PipelineStage[] = ["classification", "embeddings"];

/** Per (stage, provider) token + cost roll-up. Diff-stable ordering enforced at summarize(). */
export interface ProviderTokenUsage {
  provider: ProviderName;
  stage: PipelineStage;
  /** Model that produced these tokens, when a single model is responsible; null if mixed/unknown. */
  model: string | null;
  /** Number of provider calls recorded for this bucket. */
  calls: number;
  /** How many of those calls reported no usage (their tokens were null). */
  callsWithoutUsage: number;
  /** Sum of reported tokens; null when no call in the bucket reported usage. */
  totalTokens: number | null;
  /** Estimated USD cost; null when tokens or price are unavailable. */
  estimatedCostUsd: number | null;
}

export interface StageTotals {
  totalTokens: number | null;
  estimatedCostUsd: number | null;
}

export interface TokenAccountingSummary {
  /** Machine-readable note that all cost figures are estimates. */
  estimateBasis: EstimateBasis;
  /** Grand total tokens across every stage/provider; null if nothing reported usage. */
  totalTokens: number | null;
  /** Grand total estimated USD; null if no priced+reported usage exists. */
  estimatedCostUsd: number | null;
  byStage: Record<PipelineStage, StageTotals>;
  byProvider: ProviderTokenUsage[];
}

interface Bucket {
  provider: ProviderName;
  stage: PipelineStage;
  models: Set<string>;
  calls: number;
  callsWithoutUsage: number;
  reportedTokens: number; // sum of non-null token counts
  hasReported: boolean; // true once any call reported usage
}

function bucketKey(stage: PipelineStage, provider: ProviderName): string {
  return `${stage}::${provider}`;
}

/**
 * Aggregates the per-call token counts that already flow out of the provider
 * layer into per (stage, provider) totals, then into a diff-stable summary
 * with estimated USD cost. It holds only numbers and public model-name
 * strings — never secrets, prompts, or provider payloads.
 */
export class TokenAccumulator {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * Records one provider call. `totalTokens` is the number the provider
   * reported for that call, or `null` if it reported no usage. A `null` is
   * counted as a call-without-usage and never treated as zero.
   */
  record(
    stage: PipelineStage,
    provider: ProviderName,
    model: string | null,
    totalTokens: number | null,
  ): void {
    const key = bucketKey(stage, provider);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        provider,
        stage,
        models: new Set<string>(),
        calls: 0,
        callsWithoutUsage: 0,
        reportedTokens: 0,
        hasReported: false,
      };
      this.buckets.set(key, bucket);
    }
    bucket.calls += 1;
    if (model) bucket.models.add(model);
    if (totalTokens === null) {
      bucket.callsWithoutUsage += 1;
    } else {
      bucket.reportedTokens += totalTokens;
      bucket.hasReported = true;
    }
  }

  /** Distinct models seen across all recorded calls, sorted for stable output. */
  modelsUsed(): string[] {
    const models = new Set<string>();
    for (const bucket of this.buckets.values()) {
      for (const model of bucket.models) models.add(model);
    }
    return [...models].sort();
  }

  summarize(priceTable: PriceTable = DEFAULT_PRICE_TABLE): TokenAccountingSummary {
    const byProvider: ProviderTokenUsage[] = [...this.buckets.values()]
      .map((bucket) => {
        const model = bucket.models.size === 1 ? [...bucket.models][0]! : null;
        const totalTokens = bucket.hasReported ? bucket.reportedTokens : null;
        return {
          provider: bucket.provider,
          stage: bucket.stage,
          model,
          calls: bucket.calls,
          callsWithoutUsage: bucket.callsWithoutUsage,
          totalTokens,
          estimatedCostUsd: estimateCostUsd(model, totalTokens, priceTable),
        };
      })
      .sort(
        (a, b) => a.stage.localeCompare(b.stage) || a.provider.localeCompare(b.provider),
      );

    const byStage = {} as Record<PipelineStage, StageTotals>;
    for (const stage of PIPELINE_STAGES) {
      const rows = byProvider.filter((row) => row.stage === stage);
      byStage[stage] = foldTotals(rows);
    }

    const grand = foldTotals(byProvider);

    return {
      estimateBasis: ESTIMATE_BASIS,
      totalTokens: grand.totalTokens,
      estimatedCostUsd: grand.estimatedCostUsd,
      byStage,
      byProvider,
    };
  }
}

/**
 * Sums a set of usage rows preserving the null-vs-zero distinction: totals
 * stay `null` until at least one row reported a real value, then become the
 * sum of the reported values.
 */
function foldTotals(rows: { totalTokens: number | null; estimatedCostUsd: number | null }[]): StageTotals {
  let tokens: number | null = null;
  let cost: number | null = null;
  for (const row of rows) {
    if (row.totalTokens !== null) tokens = (tokens ?? 0) + row.totalTokens;
    if (row.estimatedCostUsd !== null) cost = (cost ?? 0) + row.estimatedCostUsd;
  }
  return { totalTokens: tokens, estimatedCostUsd: cost };
}

/** An empty summary (no provider calls recorded) — used for skipped/failed-early runs. */
export function emptyTokenSummary(): TokenAccountingSummary {
  return new TokenAccumulator().summarize();
}
