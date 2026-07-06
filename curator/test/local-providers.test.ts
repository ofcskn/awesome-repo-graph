import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createOllamaProvider } from "../src/providers/ollama.js";
import { createAnthropicProvider } from "../src/providers/anthropic.js";
import { createProviderRegistry } from "../src/providers/index.js";
import {
  ALL_PROVIDER_NAMES,
  getProviderCredentialStatus,
  PROVIDER_ENV_VARS,
} from "../src/env.js";
import type { ClassifyRequest } from "../src/providers/types.js";
import type { Candidate, Classification } from "../src/types.js";

// Mock the OpenAI SDK so the Ollama provider (which speaks the OpenAI
// chat-completions protocol) makes no real network call.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("openai", () => ({
  default: vi.fn(() => ({ chat: { completions: { create: mockCreate } } })),
}));

const candidate: Candidate = {
  canonicalUrl: "https://github.com/a/b",
  provider: "github.com",
  owner: "a",
  repo: "b",
  title: "b",
  description: "",
  stars: 100,
  forks: 1,
  license: "MIT",
  primaryLanguage: "TypeScript",
  topics: [],
  createdAt: "2024-01-01T00:00:00Z",
  lastPushAt: "2026-06-01T00:00:00Z",
  archived: false,
  isFork: false,
  defaultBranch: "main",
  homepage: null,
  discoveryMethod: "test",
  discoveredAt: new Date().toISOString(),
  githubId: 1,
  parentCanonicalUrl: null,
};

function validClassification(): Classification {
  return {
    canonicalUrl: "https://github.com/a/b",
    title: "b",
    description: "A small library.",
    taxonomyPath: ["AI Agent Tooling"],
    tags: ["mcp-server"],
    qualityScore: 80,
    relevanceScore: 80,
    maintenanceScore: 80,
    uniquenessScore: 80,
    confidenceScore: 0.9,
    accepted: true,
    rejectionReasons: [],
    evidence: [],
    relatedExistingSourceIds: [],
  };
}

function makeRequest(): ClassifyRequest {
  const { config } = loadConfig({});
  return {
    candidate,
    existingTaxonomyPaths: [],
    existingTags: [],
    existingSources: [],
    config,
  };
}

const ENV_KEYS = Object.values(PROVIDER_ENV_VARS);
function clearProviderEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
}

describe("Ollama provider (OpenAI-compatible local server)", () => {
  beforeEach(() => {
    clearProviderEnv();
    mockCreate.mockReset();
  });
  afterEach(clearProviderEnv);

  it("is usable without an API key (keyless local server)", () => {
    const provider = createOllamaProvider();
    expect(provider.isConfigured()).toBe(true);
    expect(getProviderCredentialStatus("ollama").present).toBe(true);
  });

  it("parses a mocked OpenAI-shaped response and validates the schema", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validClassification()) } }],
      usage: { total_tokens: 123 },
    });

    const provider = createOllamaProvider();
    const outcome = await provider.classify(makeRequest());

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(outcome.classification.canonicalUrl).toBe(candidate.canonicalUrl);
    expect(outcome.classification.accepted).toBe(true);
    expect(outcome.totalTokens).toBe(123);
  });

  it("treats a schema-invalid response as a provider failure", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ nope: true }) } }],
      usage: { total_tokens: 5 },
    });
    const provider = createOllamaProvider();
    await expect(provider.classify(makeRequest())).rejects.toThrow(/invalid structured response/);
  });
});

describe("Anthropic provider (Messages API)", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    clearProviderEnv();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-123456";
  });
  afterEach(() => {
    clearProviderEnv();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("is not configured without a key, configured with one", () => {
    const provider = createAnthropicProvider();
    expect(provider.isConfigured()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(provider.isConfigured()).toBe(false);
    expect(getProviderCredentialStatus("anthropic").present).toBe(false);
  });

  it("parses a mocked Messages response, validates it, and reports tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify(validClassification()) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createAnthropicProvider();
    const outcome = await provider.classify(makeRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test-123456");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBeTruthy();

    expect(outcome.classification.canonicalUrl).toBe(candidate.canonicalUrl);
    // totalTokens = input_tokens + output_tokens
    expect(outcome.totalTokens).toBe(15);
  });

  it("extracts JSON when the model wraps it in prose/fences", async () => {
    const wrapped = "Here is the result:\n```json\n" + JSON.stringify(validClassification()) + "\n```";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: wrapped }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }) as unknown as typeof fetch;

    const provider = createAnthropicProvider();
    const outcome = await provider.classify(makeRequest());
    expect(outcome.classification.accepted).toBe(true);
  });
});

describe("config + registry accept the local/hosted providers", () => {
  beforeEach(clearProviderEnv);
  afterEach(clearProviderEnv);

  it("exposes ollama and anthropic as known providers with defaults", () => {
    expect(ALL_PROVIDER_NAMES).toContain("ollama");
    expect(ALL_PROVIDER_NAMES).toContain("anthropic");
    const { config } = loadConfig({});
    expect(config.providers.models.ollama).toBeTruthy();
    expect(config.providers.models.anthropic).toBeTruthy();
    expect(config.providers.timeoutMs.ollama).toBeGreaterThan(0);
    expect(config.providers.timeoutMs.anthropic).toBeGreaterThan(0);
  });

  it("builds registry adapters for every provider (no throw)", () => {
    const registry = createProviderRegistry();
    expect(registry.ollama.name).toBe("ollama");
    expect(registry.anthropic.name).toBe("anthropic");
  });

  it("primaryProvider override forces the provider as primary and adds it to enabled", () => {
    const { config } = loadConfig({ primaryProvider: "ollama" });
    expect(config.providers.primary).toBe("ollama");
    expect(config.providers.enabled).toContain("ollama");
    // Existing providers remain available as fallback.
    expect(config.providers.enabled).toContain("openai");
  });

  it("commitMode override changes the output mode", () => {
    const base = loadConfig({}).config;
    expect(base.output.commitMode).toBe("commit");
    const forced = loadConfig({ primaryProvider: "anthropic", commitMode: "report-only" }).config;
    expect(forced.output.commitMode).toBe("report-only");
    expect(forced.providers.primary).toBe("anthropic");
  });
});
