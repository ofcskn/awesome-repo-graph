import { createOpenAICompatibleProvider } from "./openai-compatible-base.js";
import { getOllamaBaseURL } from "../env.js";
import type { AIProvider } from "./types.js";

/**
 * Ollama / OpenAI-compatible local-server adapter. Ollama exposes an
 * OpenAI chat-completions endpoint (default `http://localhost:11434/v1`), so
 * this reuses the OpenAI base with a configurable base URL and model name.
 *
 * The base URL is read at call time from `OLLAMA_BASE_URL` (see env.ts), and
 * the model is `config.providers.models.ollama` — so pointing at any other
 * OpenAI-protocol server (llama.cpp, vLLM, LM Studio, …) and running a
 * different local model (e.g. `hermes3`, or an "OpenClaw" tag) is pure
 * configuration, no new code. Local servers usually need no API key, so this
 * provider is keyless (`apiKeyOptional`) and sends a placeholder key to
 * satisfy the OpenAI SDK; set `OLLAMA_API_KEY` if your server enforces one.
 *
 * `json_object` mode is used (not strict `json_schema`) because local
 * servers vary in schema support; the response is still validated against
 * `classification/schema.ts` via zod, so malformed output is a normal
 * provider failure that falls back to the next provider.
 */
export function createOllamaProvider(): AIProvider {
  return createOpenAICompatibleProvider({
    name: "ollama",
    resolveBaseURL: getOllamaBaseURL,
    supportsJsonSchema: false,
    apiKeyOptional: true,
    placeholderApiKey: "ollama",
  });
}
