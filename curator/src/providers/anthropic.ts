import { getAnthropicBaseURL, getProviderSecret } from "../env.js";
import { safeParseClassification } from "../classification/schema.js";
import { createLimiter } from "./limiter.js";
import { buildClassificationPrompt } from "./prompt.js";
import { withRetryAndTimeout } from "./retry.js";
import type { AIProvider, ClassifyOutcome, ClassifyRequest } from "./types.js";
import { ProviderConfigurationError, ProviderResponseValidationError, sanitizeProviderError } from "./types.js";

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  content?: AnthropicTextBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Extracts a JSON object from a model text response. Prefers a direct parse;
 * falls back to the first `{`…`}` span for models that wrap the object in a
 * code fence or prose. Returns undefined if nothing parses.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/**
 * Anthropic Claude adapter — implements `AIProvider` against the Messages API
 * (`POST /v1/messages`). Reads `ANTHROPIC_API_KEY` (see env.ts); base URL is
 * overridable via `ANTHROPIC_BASE_URL`. The shared classification prompt's
 * system text becomes the top-level `system` field and the user text the
 * single user message; the response text block is parsed as JSON and
 * validated with the same zod schema as every other provider (a malformed or
 * schema-invalid response is a normal provider failure that falls back).
 *
 * Uses `fetch` rather than an SDK so no dependency is added (keeping `npm ci`
 * reproducible) and the HTTP call is trivially mockable in tests.
 * `totalTokens` is populated from `usage.input_tokens + usage.output_tokens`
 * for cost accounting.
 */
export function createAnthropicProvider(): AIProvider {
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
    name: "anthropic",
    isConfigured(): boolean {
      return getProviderSecret("anthropic") !== undefined;
    },
    async classify(request: ClassifyRequest): Promise<ClassifyOutcome> {
      const apiKey = getProviderSecret("anthropic");
      if (!apiKey) {
        throw new ProviderConfigurationError("anthropic", "missing API key");
      }

      const model = request.config.providers.models.anthropic!;
      const timeoutMs = request.config.providers.timeoutMs.anthropic!;
      const maxRetries = request.config.providers.maxRetries;
      const concurrency = request.config.providers.maxConcurrentRequests;
      const runLimited = ensureLimiter(concurrency);
      const baseURL = getAnthropicBaseURL();

      const { system, user } = buildClassificationPrompt(
        request.candidate,
        request.existingTaxonomyPaths,
        request.existingTags,
        request.existingSources,
      );

      const { result, attempts, latencyMs } = await runLimited(() =>
        withRetryAndTimeout(
          async (signal) => {
            const response = await fetch(`${baseURL}/v1/messages`, {
              method: "POST",
              signal,
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_VERSION,
              },
              body: JSON.stringify({
                model,
                max_tokens: MAX_TOKENS,
                system,
                messages: [{ role: "user", content: user }],
              }),
            });
            if (!response.ok) {
              // Attach the HTTP status so the retry layer can classify 429/5xx
              // as retryable and 4xx as terminal.
              const error = new Error(`Anthropic API error ${response.status}`) as Error & {
                status?: number;
              };
              error.status = response.status;
              throw error;
            }
            return (await response.json()) as AnthropicMessagesResponse;
          },
          { maxRetries, timeoutMs },
        ),
      );

      const text = result.content?.find((block) => block.type === "text")?.text;
      if (!text) {
        throw new ProviderResponseValidationError("anthropic", "empty response text");
      }

      const raw = extractJson(text);
      if (raw === undefined) {
        throw new ProviderResponseValidationError("anthropic", "response was not valid JSON");
      }

      const parsed = safeParseClassification(raw);
      if (!parsed.success) {
        throw new ProviderResponseValidationError("anthropic", sanitizeProviderError(parsed.error));
      }

      const inputTokens = result.usage?.input_tokens ?? 0;
      const outputTokens = result.usage?.output_tokens ?? 0;
      const totalTokens = result.usage ? inputTokens + outputTokens : null;

      return {
        classification: parsed.data,
        attempts,
        latencyMs,
        totalTokens,
      };
    },
  };
}
