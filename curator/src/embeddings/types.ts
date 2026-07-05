import type { ProviderName } from "../env.js";

/** DeepSeek has no embeddings endpoint — see config.ts's schema comment. */
// Only these providers expose an embeddings endpoint. DeepSeek has none;
// the local Ollama and hosted Anthropic classification adapters are not used
// for embeddings here (kept in sync with config.ts's embeddingProviderNameSchema).
export type EmbeddingProviderName = Exclude<ProviderName, "deepseek" | "ollama" | "anthropic">;

export const ALL_EMBEDDING_PROVIDER_NAMES: EmbeddingProviderName[] = ["openai", "gemini", "vertexGemini"];

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  isConfigured(): boolean;
  /** Batched: pass every text you need embedded in one call where possible to reduce request overhead/cost. */
  embed(texts: string[]): Promise<number[][]>;
}
