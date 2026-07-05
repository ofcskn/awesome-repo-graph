import { createOpenAICompatibleProvider } from "./openai-compatible-base.js";
import type { AIProvider } from "./types.js";

/**
 * DeepSeek adapter — reads DEEPSEEK_API_KEY (see env.ts). DeepSeek's API is
 * OpenAI-compatible (https://api.deepseek.com) but only supports
 * `response_format: {type: "json_object"}`, not strict json_schema, so we
 * validate the JSON body ourselves via zod after the call (same as OpenAI
 * path, just without the provider-side schema guarantee).
 */
export function createDeepSeekProvider(): AIProvider {
  return createOpenAICompatibleProvider({
    name: "deepseek",
    baseURL: "https://api.deepseek.com",
    supportsJsonSchema: false,
  });
}
