import { createOpenAICompatibleProvider } from "./openai-compatible-base.js";
import type { AIProvider } from "./types.js";

/** OpenAI adapter — reads OPENAI_API_KEY (see env.ts), supports strict json_schema output. */
export function createOpenAIProvider(): AIProvider {
  return createOpenAICompatibleProvider({
    name: "openai",
    supportsJsonSchema: true,
  });
}
