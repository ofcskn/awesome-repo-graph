import OpenAI from "openai";
import { getProviderSecret } from "../env.js";
import { classificationJsonSchema, safeParseClassification } from "../classification/schema.js";
import { createLimiter } from "./limiter.js";
import { buildClassificationPrompt } from "./prompt.js";
import { withRetryAndTimeout } from "./retry.js";
import type { AIProvider, ClassifyOutcome, ClassifyRequest } from "./types.js";
import { ProviderConfigurationError, ProviderResponseValidationError, sanitizeProviderError } from "./types.js";
import type { ProviderName } from "../env.js";

export interface OpenAICompatibleOptions {
  name: ProviderName;
  /** Override base URL for OpenAI-compatible third-party APIs (e.g. DeepSeek). */
  baseURL?: string;
  /**
   * Resolves the base URL at call time (wins over `baseURL`). Lets a local
   * server's endpoint be env-driven, e.g. Ollama's `OLLAMA_BASE_URL`, so any
   * OpenAI-protocol server (Hermes, "OpenClaw", …) works by configuration.
   */
  resolveBaseURL?: () => string;
  /**
   * OpenAI supports strict `json_schema` response_format; some
   * OpenAI-compatible providers (DeepSeek) only support `json_object`
   * mode, so the schema is enforced by us via zod after the fact.
   */
  supportsJsonSchema: boolean;
  /**
   * When true, the provider is usable without a real API key (local servers
   * like Ollama). It reports as configured, and a placeholder key is sent to
   * satisfy the OpenAI SDK's required-key check.
   */
  apiKeyOptional?: boolean;
  /** Placeholder key sent when `apiKeyOptional` and no real key is set (default "ollama"). */
  placeholderApiKey?: string;
}

/**
 * Shared implementation for any provider that speaks the OpenAI chat-completions
 * wire protocol. Provider-specific files (openai.ts, deepseek.ts) just supply
 * the base URL and capability flags — no request-shaping logic lives outside here.
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): AIProvider {
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
      if (options.apiKeyOptional) return true;
      return getProviderSecret(options.name) !== undefined;
    },
    async classify(request: ClassifyRequest): Promise<ClassifyOutcome> {
      const apiKey =
        getProviderSecret(options.name) ??
        (options.apiKeyOptional ? options.placeholderApiKey ?? "ollama" : undefined);
      if (!apiKey) {
        throw new ProviderConfigurationError(options.name, "missing API key");
      }
      const baseURL = options.resolveBaseURL ? options.resolveBaseURL() : options.baseURL;

      const model = request.config.providers.models[options.name]!;
      const timeoutMs = request.config.providers.timeoutMs[options.name]!;
      const maxRetries = request.config.providers.maxRetries;
      const concurrency = request.config.providers.maxConcurrentRequests;
      const runLimited = ensureLimiter(concurrency);

      const client = new OpenAI({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 0 });
      const { system, user } = buildClassificationPrompt(
        request.candidate,
        request.existingTaxonomyPaths,
        request.existingTags,
        request.existingSources,
      );

      const { result, attempts, latencyMs } = await runLimited(() =>
        withRetryAndTimeout(
          async (signal) => {
            const completion = await client.chat.completions.create(
              {
                model,
                temperature: 0,
                messages: [
                  { role: "system", content: system },
                  { role: "user", content: user },
                ],
                response_format: options.supportsJsonSchema
                  ? {
                      type: "json_schema",
                      json_schema: {
                        name: "classification",
                        strict: true,
                        schema: classificationJsonSchema,
                      },
                    }
                  : { type: "json_object" },
              },
              { signal },
            );
            return completion;
          },
          { maxRetries, timeoutMs },
        ),
      );

      const content = result.choices[0]?.message?.content;
      if (!content) {
        throw new ProviderResponseValidationError(options.name, "empty response content");
      }

      let raw: unknown;
      try {
        raw = JSON.parse(content);
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
        totalTokens: result.usage?.total_tokens ?? null,
      };
    },
  };
}
