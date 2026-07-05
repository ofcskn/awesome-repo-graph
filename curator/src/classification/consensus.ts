import { classifyWithFallback, orderProvidersForFallback } from "../providers/index.js";
import type { AIProvider, ClassifyRequest } from "../providers/index.js";
import type { CuratorConfig } from "../config.js";
import type {
  Candidate,
  Classification,
  ConsensusResult,
  ExistingSourceSummary,
  ProviderClassification,
  RejectionReasonCode,
} from "../types.js";
import type { ProviderName } from "../env.js";

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

function applyQualityGate(
  classification: Classification,
  config: CuratorConfig,
): { accepted: boolean; reasons: RejectionReasonCode[] } {
  const reasons: RejectionReasonCode[] = [...(classification.accepted ? [] : (["off-topic"] as RejectionReasonCode[]))];
  if (classification.confidenceScore < config.quality.minClassificationConfidence) {
    reasons.push("low-confidence");
  }
  if (classification.qualityScore < config.quality.minQualityScore) {
    reasons.push("low-quality-score");
  }
  const accepted = classification.accepted && reasons.length === 0;
  return { accepted, reasons };
}

async function runSingleStrategy(
  request: ClassifyRequest,
  providers: AIProvider[],
  config: CuratorConfig,
): Promise<ConsensusResult> {
  const ordered = orderProvidersForFallback(config, providers);
  const fallback = await classifyWithFallback(request, ordered);

  const perProvider: ProviderClassification[] = fallback.attempts.map((attempt) => {
    const isWinner = fallback.provider === attempt.provider && fallback.outcome !== null;
    return {
      provider: attempt.provider,
      classification: attempt.succeeded && isWinner ? fallback.outcome!.classification : null,
      error: attempt.error,
      attempts: 1,
      latencyMs: isWinner ? fallback.outcome!.latencyMs : 0,
      // Only the winning provider actually produced tokens; failed attempts threw before usage.
      totalTokens: isWinner ? fallback.outcome!.totalTokens : null,
    };
  });

  if (!fallback.outcome) {
    return {
      candidate: request.candidate,
      perProvider,
      finalClassification: null,
      finalConfidence: 0,
      accepted: false,
      deferred: false,
      disagreements: [],
      rejectionReasons: ["provider-error"],
    };
  }

  const gate = applyQualityGate(fallback.outcome.classification, config);
  return {
    candidate: request.candidate,
    perProvider,
    finalClassification: fallback.outcome.classification,
    finalConfidence: fallback.outcome.classification.confidenceScore,
    accepted: gate.accepted,
    deferred: false,
    disagreements: [],
    rejectionReasons: gate.accepted ? [] : gate.reasons,
  };
}

async function runMultiReviewerStrategy(
  request: ClassifyRequest,
  providers: AIProvider[],
  config: CuratorConfig,
): Promise<ConsensusResult> {
  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({ provider, outcome: await provider.classify(request) })),
  );

  const perProvider: ProviderClassification[] = settled.map((result, index) => {
    const provider = providers[index]!;
    if (result.status === "fulfilled") {
      return {
        provider: provider.name,
        classification: result.value.outcome.classification,
        error: null,
        attempts: result.value.outcome.attempts,
        latencyMs: result.value.outcome.latencyMs,
        totalTokens: result.value.outcome.totalTokens,
      };
    }
    return {
      provider: provider.name,
      classification: null,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      attempts: 1,
      latencyMs: 0,
      totalTokens: null,
    };
  });

  const successes = perProvider.filter(
    (p): p is ProviderClassification & { classification: Classification } => p.classification !== null,
  );

  if (successes.length === 0) {
    return {
      candidate: request.candidate,
      perProvider,
      finalClassification: null,
      finalConfidence: 0,
      accepted: false,
      deferred: false,
      disagreements: [],
      rejectionReasons: ["provider-error"],
    };
  }

  const weights = config.providers.weights;
  const totalWeight = successes.reduce((sum, p) => sum + (weights[p.provider] ?? 1), 0);
  const acceptedWeight = successes
    .filter((p) => p.classification.accepted)
    .reduce((sum, p) => sum + (weights[p.provider] ?? 1), 0);
  const acceptFraction = totalWeight > 0 ? acceptedWeight / totalWeight : 0;
  const weightedConfidence =
    successes.reduce((sum, p) => sum + (weights[p.provider] ?? 1) * p.classification.confidenceScore, 0) /
    totalWeight;

  const disagreements: string[] = [];
  const first = successes[0]!.classification;
  for (const p of successes.slice(1)) {
    if (p.classification.accepted !== first.accepted) {
      disagreements.push(
        `${p.provider} accepted=${p.classification.accepted} vs baseline accepted=${first.accepted}`,
      );
    }
    if (p.classification.taxonomyPath[0] !== first.taxonomyPath[0]) {
      disagreements.push(
        `${p.provider} taxonomy sector "${p.classification.taxonomyPath[0]}" differs from baseline "${first.taxonomyPath[0]}"`,
      );
    }
    if (jaccard(p.classification.tags, first.tags) < 0.5) {
      disagreements.push(`${p.provider} tag set diverges significantly from baseline`);
    }
  }

  const majorityAccepted = acceptFraction >= 0.5;
  const candidatesForFinal = successes.filter((p) => p.classification.accepted === majorityAccepted);
  const pool = candidatesForFinal.length > 0 ? candidatesForFinal : successes;
  const primary = pool.find((p) => p.provider === config.providers.primary) ?? pool[0]!;
  const finalClassification: Classification = { ...primary.classification, confidenceScore: weightedConfidence };

  const meetsConsensus = acceptFraction >= config.quality.consensusThreshold;
  const gate = applyQualityGate(finalClassification, config);
  const accepted = meetsConsensus && gate.accepted;
  const deferred = !accepted && acceptFraction > 0 && acceptFraction < config.quality.consensusThreshold && disagreements.length > 0;

  const rejectionReasons: RejectionReasonCode[] = accepted
    ? []
    : meetsConsensus
      ? gate.reasons
      : ["below-consensus-threshold", ...gate.reasons];

  return {
    candidate: request.candidate,
    perProvider,
    finalClassification,
    finalConfidence: weightedConfidence,
    accepted,
    deferred,
    disagreements,
    rejectionReasons,
  };
}

export interface ClassificationContext {
  existingTaxonomyPaths: string[][];
  existingTags: string[];
  existingSources: ExistingSourceSummary[];
  config: CuratorConfig;
}

/**
 * Entry point used by run.ts: dispatches to the configured
 * providers.consensusStrategy. "primary-with-fallback" (and any run with
 * only one usable provider) uses the fast single-chain path; every other
 * strategy name runs all enabled providers and reconciles their votes —
 * see MULTI-MODEL REVIEW in the project spec for the full strategy list.
 * `disagreement-triggered-review` and `high-risk-review` are realized here
 * as "surface the disagreement and defer" rather than as separate code
 * paths, since the underlying signal (provider disagreement / low
 * consensus) is the same; `taxonomy-only-secondary` is not yet implemented
 * as a distinct secondary-pass call and falls back to weighted-consensus.
 */
export async function runClassification(
  candidate: Candidate,
  context: ClassificationContext,
  providers: AIProvider[],
): Promise<ConsensusResult> {
  if (providers.length === 0) {
    return {
      candidate,
      perProvider: [],
      finalClassification: null,
      finalConfidence: 0,
      accepted: false,
      deferred: false,
      disagreements: [],
      rejectionReasons: ["provider-error"],
    };
  }

  const request: ClassifyRequest = {
    candidate,
    existingTaxonomyPaths: context.existingTaxonomyPaths,
    existingTags: context.existingTags,
    existingSources: context.existingSources,
    config: context.config,
  };

  const strategy = context.config.providers.consensusStrategy;
  if (strategy === "primary-with-fallback" || providers.length === 1) {
    return runSingleStrategy(request, providers, context.config);
  }
  return runMultiReviewerStrategy(request, providers, context.config);
}

export type { ProviderName };
