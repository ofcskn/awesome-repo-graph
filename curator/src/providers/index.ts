import { ALL_PROVIDER_NAMES, validateProviderEnv } from "../env.js";
import type { ProviderName } from "../env.js";
import type { CuratorConfig } from "../config.js";
import { createOpenAIProvider } from "./openai.js";
import { createDeepSeekProvider } from "./deepseek.js";
import { createGeminiProvider } from "./gemini.js";
import { createVertexGeminiProvider } from "./vertex-gemini.js";
import type { AIProvider, ClassifyOutcome, ClassifyRequest } from "./types.js";
import { sanitizeProviderError } from "./types.js";

const FACTORIES: Record<ProviderName, () => AIProvider> = {
  openai: createOpenAIProvider,
  deepseek: createDeepSeekProvider,
  gemini: createGeminiProvider,
  vertexGemini: createVertexGeminiProvider,
};

export function createProviderRegistry(): Record<ProviderName, AIProvider> {
  const registry = {} as Record<ProviderName, AIProvider>;
  for (const name of ALL_PROVIDER_NAMES) {
    registry[name] = FACTORIES[name]();
  }
  return registry;
}

export interface EnabledProvidersResult {
  providers: AIProvider[];
  disabledProviders: { provider: ProviderName; envVar: string; reason: string }[];
  warnings: string[];
}

/**
 * Resolves config.providers.enabled against actual credential availability.
 * A provider configured in config.ts but missing its secret is disabled
 * with a sanitized warning rather than causing a hard failure — the run
 * only fails (in env.ts's validateProviderEnv) when NONE are usable.
 */
export function getEnabledProviders(
  config: CuratorConfig,
  registry: Record<ProviderName, AIProvider>,
): EnabledProvidersResult {
  const envResult = validateProviderEnv(config.providers.enabled);
  const providers = envResult.enabledProviders
    .map((name) => registry[name])
    .filter((provider) => provider.isConfigured());
  return {
    providers,
    disabledProviders: envResult.disabledProviders,
    warnings: envResult.warnings,
  };
}

export interface FallbackAttempt {
  provider: ProviderName;
  succeeded: boolean;
  error: string | null;
}

export interface FallbackResult {
  outcome: ClassifyOutcome | null;
  provider: ProviderName | null;
  attempts: FallbackAttempt[];
}

/**
 * Implements the "primary-with-fallback" strategy: try providers in the
 * given order (primary first) and return the first success. Every attempt
 * (success or sanitized failure) is recorded for the audit report.
 */
export async function classifyWithFallback(
  request: ClassifyRequest,
  orderedProviders: AIProvider[],
): Promise<FallbackResult> {
  const attempts: FallbackAttempt[] = [];

  for (const provider of orderedProviders) {
    try {
      const outcome = await provider.classify(request);
      attempts.push({ provider: provider.name, succeeded: true, error: null });
      return { outcome, provider: provider.name, attempts };
    } catch (error) {
      attempts.push({
        provider: provider.name,
        succeeded: false,
        error: sanitizeProviderError(error),
      });
    }
  }

  return { outcome: null, provider: null, attempts };
}

export function orderProvidersForFallback(
  config: CuratorConfig,
  enabled: AIProvider[],
): AIProvider[] {
  const byName = new Map(enabled.map((p) => [p.name, p]));
  const ordered: AIProvider[] = [];
  const primary = byName.get(config.providers.primary);
  if (primary) ordered.push(primary);
  for (const name of config.providers.fallbackOrder) {
    const provider = byName.get(name);
    if (provider && !ordered.includes(provider)) ordered.push(provider);
  }
  for (const provider of enabled) {
    if (!ordered.includes(provider)) ordered.push(provider);
  }
  return ordered;
}

export type { AIProvider, ClassifyOutcome, ClassifyRequest } from "./types.js";
