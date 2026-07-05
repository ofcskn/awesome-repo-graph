import { createGeminiCompatibleProvider } from "./gemini-compatible-base.js";
import type { AIProvider } from "./types.js";

/**
 * Vertex Gemini adapter — reads GEMINI_VERTEX_API_KEY (see env.ts). Uses
 * Vertex AI Express Mode (vertexai:true + apiKey), which does not require a
 * GCP project/location or service-account credentials.
 */
export function createVertexGeminiProvider(): AIProvider {
  return createGeminiCompatibleProvider({ name: "vertexGemini", vertexMode: true });
}
