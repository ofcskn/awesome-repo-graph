import { createGeminiCompatibleProvider } from "./gemini-compatible-base.js";
import type { AIProvider } from "./types.js";

/** Gemini Developer API adapter — reads GEMINI_API_KEY (see env.ts). */
export function createGeminiProvider(): AIProvider {
  return createGeminiCompatibleProvider({ name: "gemini", vertexMode: false });
}
