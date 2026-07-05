import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getProviderSecret } from "../env.js";
import { ALL_EMBEDDING_PROVIDER_NAMES } from "./types.js";
import type { EmbeddingProvider, EmbeddingProviderName } from "./types.js";
import type { CuratorConfig } from "../config.js";

function createOpenAIEmbeddingProvider(model: string, dimensions: number): EmbeddingProvider {
  return {
    name: "openai",
    isConfigured: () => getProviderSecret("openai") !== undefined,
    async embed(texts) {
      const apiKey = getProviderSecret("openai");
      if (!apiKey) throw new Error("OpenAI embeddings: OPENAI_API_KEY is not set");
      const client = new OpenAI({ apiKey });
      const response = await client.embeddings.create({ model, input: texts, dimensions });
      return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    },
  };
}

function createGeminiCompatibleEmbeddingProvider(
  name: Extract<EmbeddingProviderName, "gemini" | "vertexGemini">,
  vertexMode: boolean,
  model: string,
  dimensions: number,
): EmbeddingProvider {
  return {
    name,
    isConfigured: () => getProviderSecret(name) !== undefined,
    async embed(texts) {
      const apiKey = getProviderSecret(name);
      if (!apiKey) throw new Error(`${name} embeddings: env var is not set`);
      const client = new GoogleGenAI(vertexMode ? { vertexai: true, apiKey } : { apiKey });
      const response = await client.models.embedContent({
        model,
        contents: texts,
        config: { outputDimensionality: dimensions },
      });
      return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
    },
  };
}

export function createEmbeddingRegistry(config: CuratorConfig): Record<EmbeddingProviderName, EmbeddingProvider> {
  const { models, dimensions } = config.embeddings;
  return {
    openai: createOpenAIEmbeddingProvider(models.openai!, dimensions),
    gemini: createGeminiCompatibleEmbeddingProvider("gemini", false, models.gemini!, dimensions),
    vertexGemini: createGeminiCompatibleEmbeddingProvider("vertexGemini", true, models.vertexGemini!, dimensions),
  };
}

/**
 * Prefers config.embeddings.provider, but falls back to any other
 * embedding-capable provider that actually has credentials — mirrors the
 * classification providers' fail-soft posture (embeddings are an
 * optimization, never a hard requirement for the pipeline to run).
 */
export function resolveEmbeddingProvider(config: CuratorConfig): EmbeddingProvider | null {
  if (!config.embeddings.enabled) return null;
  const registry = createEmbeddingRegistry(config);
  const preferenceOrder: EmbeddingProviderName[] = [
    config.embeddings.provider,
    ...ALL_EMBEDDING_PROVIDER_NAMES.filter((name) => name !== config.embeddings.provider),
  ];
  for (const name of preferenceOrder) {
    if (registry[name].isConfigured()) return registry[name];
  }
  return null;
}
