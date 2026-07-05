import { GoogleGenAI, Type } from "@google/genai";
import { getProviderSecret } from "../env.js";
import { safeParseClassification } from "../classification/schema.js";
import { createLimiter } from "./limiter.js";
import { buildClassificationPrompt } from "./prompt.js";
import { withRetryAndTimeout } from "./retry.js";
import type { AIProvider, ClassifyOutcome, ClassifyRequest } from "./types.js";
import { ProviderConfigurationError, ProviderResponseValidationError, sanitizeProviderError } from "./types.js";
import type { ProviderName } from "../env.js";

const GEMINI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canonicalUrl: { type: Type.STRING },
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    taxonomyPath: { type: Type.ARRAY, items: { type: Type.STRING } },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    qualityScore: { type: Type.NUMBER },
    relevanceScore: { type: Type.NUMBER },
    maintenanceScore: { type: Type.NUMBER },
    uniquenessScore: { type: Type.NUMBER },
    confidenceScore: { type: Type.NUMBER },
    accepted: { type: Type.BOOLEAN },
    rejectionReasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
    relatedExistingSourceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "canonicalUrl",
    "title",
    "description",
    "taxonomyPath",
    "tags",
    "qualityScore",
    "relevanceScore",
    "maintenanceScore",
    "uniquenessScore",
    "confidenceScore",
    "accepted",
    "rejectionReasons",
    "evidence",
    "relatedExistingSourceIds",
  ],
};

export interface GeminiCompatibleOptions {
  name: ProviderName; // "gemini" | "vertexGemini"
  /** true => Vertex AI Express Mode (vertexai:true + apiKey, no project/location needed). */
  vertexMode: boolean;
}

/**
 * Shared implementation for both Gemini surfaces exposed by @google/genai:
 * the Gemini Developer API (apiKey only) and Vertex AI Express Mode
 * (vertexai:true + apiKey). Provider-specific files just flip `vertexMode`.
 */
export function createGeminiCompatibleProvider(options: GeminiCompatibleOptions): AIProvider {
  let limiterConcurrency = 1;
  let limiterFn = createLimiter(limiterConcurrency);
  function ensureLimiter(concurrency: number) {
    if (concurrency !== limiterConcurrency) {
      limiterConcurrency = concurrency;
      limiterFn = createLimiter(concurrency);
    }
    return limiterFn;
  }

  return {
    name: options.name,
    isConfigured(): boolean {
      return getProviderSecret(options.name) !== undefined;
    },
    async classify(request: ClassifyRequest): Promise<ClassifyOutcome> {
      const apiKey = getProviderSecret(options.name);
      if (!apiKey) {
        throw new ProviderConfigurationError(options.name, "missing API key");
      }

      const model = request.config.providers.models[options.name]!;
      const timeoutMs = request.config.providers.timeoutMs[options.name]!;
      const maxRetries = request.config.providers.maxRetries;
      const concurrency = request.config.providers.maxConcurrentRequests;
      const runLimited = ensureLimiter(concurrency);

      const client = new GoogleGenAI(
        options.vertexMode
          ? { vertexai: true, apiKey, httpOptions: { timeout: timeoutMs } }
          : { apiKey, httpOptions: { timeout: timeoutMs } },
      );

      const { system, user } = buildClassificationPrompt(
        request.candidate,
        request.existingTaxonomyPaths,
        request.existingTags,
        request.existingSources,
      );

      const { result, attempts, latencyMs } = await runLimited(() =>
        withRetryAndTimeout(
          async () => {
            const response = await client.models.generateContent({
              model,
              contents: user,
              config: {
                systemInstruction: system,
                temperature: 0,
                responseMimeType: "application/json",
                responseSchema: GEMINI_RESPONSE_SCHEMA,
              },
            });
            return response;
          },
          { maxRetries, timeoutMs },
        ),
      );

      const text = result.text;
      if (!text) {
        throw new ProviderResponseValidationError(options.name, "empty response text");
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new ProviderResponseValidationError(options.name, "response was not valid JSON");
      }

      const parsed = safeParseClassification(raw);
      if (!parsed.success) {
        throw new ProviderResponseValidationError(
          options.name,
          sanitizeProviderError(parsed.error),
        );
      }

      return {
        classification: parsed.data,
        attempts,
        latencyMs,
        totalTokens: result.usageMetadata?.totalTokenCount ?? null,
      };
    },
  };
}
