/**
 * Estimated model pricing for run cost accounting.
 *
 * Providers report a single `total_tokens` figure per call (not a split
 * input/output count), so the honest granularity here is a *blended* USD
 * rate per 1,000,000 tokens per model:
 *
 *     cost_usd = (total_tokens / 1_000_000) * usdPer1MTokens(model)
 *
 * Every figure is an ESTIMATE. It exists so an operator can see the rough
 * shape of spend, not to reconcile a bill. Rates live here (a dedicated
 * module) rather than in config.ts so that editing a price never churns the
 * config fingerprint that scopes rejection memory.
 *
 * This module holds NO secrets: it maps public model names to public rates.
 */

export interface ModelPrice {
  /** Blended USD rate per 1,000,000 tokens (input + output, estimated). */
  usdPer1MTokens: number;
}

export type PriceTable = Record<string, ModelPrice>;

/**
 * Default estimated rates, keyed by the exact model strings used in
 * `config.ts` (`providers.models` / `embeddings.models`). An unknown model
 * intentionally has no entry, which yields a `null` cost estimate rather
 * than a fabricated number.
 */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  // Classification models.
  "gpt-5.5": { usdPer1MTokens: 5.0 },
  "deepseek-v4-pro": { usdPer1MTokens: 1.1 },
  "gemini-2.5-flash": { usdPer1MTokens: 0.6 },
  // Embedding models (retained for when embedding usage is surfaced).
  "text-embedding-3-small": { usdPer1MTokens: 0.02 },
  "gemini-embedding-001": { usdPer1MTokens: 0.15 },
};

/** Machine-readable label attached to every cost figure this module produces. */
export const ESTIMATE_BASIS = "config-price-table" as const;
export type EstimateBasis = typeof ESTIMATE_BASIS;

/**
 * Estimates the USD cost of `totalTokens` for `model`.
 *
 * Returns `null` (never `0`) when the cost cannot be estimated: no model,
 * no reported tokens, or an unpriced model. `null` means "unknown", which
 * is different from a real zero.
 */
export function estimateCostUsd(
  model: string | null,
  totalTokens: number | null,
  priceTable: PriceTable = DEFAULT_PRICE_TABLE,
): number | null {
  if (model === null || totalTokens === null) return null;
  const price = priceTable[model];
  if (!price) return null;
  return (totalTokens / 1_000_000) * price.usdPer1MTokens;
}
