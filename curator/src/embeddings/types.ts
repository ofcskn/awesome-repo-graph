import type { ProviderName } from "../env.js";

/** DeepSeek has no embeddings endpoint — see config.ts's schema comment. */
export type EmbeddingProviderName = Exclude<ProviderName, "deepseek">;

export const ALL_EMBEDDING_PROVIDER_NAMES: EmbeddingProviderName[] = ["openai", "gemini", "vertexGemini"];

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  isConfigured(): boolean;
  /** Batched: pass every text you need embedded in one call where possible to reduce request overhead/cost. */
  embed(texts: string[]): Promise<number[][]>;
}
