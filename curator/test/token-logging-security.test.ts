import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalizeReportForWrite, type RunReport } from "../src/reporting/report.js";
import { TokenAccumulator } from "../src/reporting/token-accounting.js";
import { buildLedgerEntry } from "../src/reporting/ledger.js";
import { readAgentMetadata } from "../src/reporting/agent.js";

/**
 * A realistic finished report, including the token-accounting + agent fields
 * this subsystem adds. Uses real model names so the scan below can't pass
 * just because the object is empty.
 */
function makeReport(): RunReport {
  const tokens = new TokenAccumulator();
  tokens.record("classification", "openai", "gpt-5.5", 1234);
  tokens.record("classification", "gemini", "gemini-2.5-flash", 567);
  tokens.record("classification", "deepseek", "deepseek-v4-pro", null);
  tokens.record("embeddings", "vertexGemini", "gemini-embedding-001", null);
  const tokenUsage = tokens.summarize();

  return {
    runId: "2026-07-05",
    startedAt: "2026-07-05T00:00:00.000Z",
    completedAt: "2026-07-05T00:02:00.000Z",
    status: "success",
    configFingerprint: "cfg_deadbeef",
    agent: { name: readAgentMetadata().name, version: readAgentMetadata().version, primaryModels: tokens.modelsUsed() },
    tokenUsage,
    activeProviders: ["openai", "gemini", "deepseek", "vertexGemini"],
    disabledProviders: [],
    searchQueries: ["topic:ai-agent stars:>200"],
    discoveryMethods: ["github-search"],
    counts: { discovered: 5, mechanicallyRejected: 2, sentToAiReview: 3, accepted: 1, rejected: 1, deferred: 1 },
    acceptedSourceUrls: ["https://github.com/example/repo"],
    finalTaxonomyPaths: [["AI Agent Tooling"]],
    finalTags: ["mcp-server"],
    rejectionReasonCounts: { "low-quality-score": 1 },
    duplicateMatches: [],
    providerDisagreements: [],
    providerFailures: [{ candidateUrl: "https://github.com/x/y", provider: "openai", error: "rate limited" }],
    retryCounts: { openai: 1 },
    filesChanged: ["sources.json", "curator/state/token-ledger.json"],
    commandsExecuted: ["node scripts/add-source.js --url https://github.com/example/repo"],
    scoreRefresh: null,
    validation: { readmeGenerated: true, sourcesJsonValid: true, errors: [] },
    build: { ran: false, succeeded: true, error: null },
    output: { mode: "pull-request", commit: null, pullRequest: null, pagesDeployDispatch: null },
    notes: [],
  };
}

/** Patterns that must never appear in a serialized report or ledger. */
const SECRET_SHAPED = [
  /sk-[A-Za-z0-9_-]{6,}/, // OpenAI-style keys
  /key-[A-Za-z0-9_-]{6,}/, // generic key- prefix
  /AIza[A-Za-z0-9_-]{10,}/, // Google API keys
  /Bearer\s+[A-Za-z0-9._-]+/i, // bearer tokens
  /"?authorization"?\s*[:=]/i, // auth headers/fields
  /\bap[iI]?[-_]?[kK]ey\b/, // apiKey / api_key field names
];

const PLANTED_ENV = {
  OPENAI_API_KEY: "sk-live-PLANTED0123456789abcdef",
  GEMINI_API_KEY: "AIzaPLANTEDsecret0123456789",
  DEEPSEEK_API_KEY: "key-PLANTEDdeepseek0123456789",
  GEMINI_VERTEX_API_KEY: "sk-vertex-PLANTED0123456789",
};

describe("run/token logging security", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(PLANTED_ENV)) process.env[k] = v;
  });
  afterEach(() => {
    for (const k of Object.keys(PLANTED_ENV)) delete process.env[k];
  });

  it("serialized report contains no secret-shaped strings", () => {
    const json = JSON.stringify(finalizeReportForWrite(makeReport()), null, 2);
    for (const pattern of SECRET_SHAPED) {
      expect(json, `matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it("serialized report does not leak any planted env-var value", () => {
    const json = JSON.stringify(finalizeReportForWrite(makeReport()));
    for (const value of Object.values(PLANTED_ENV)) {
      expect(json).not.toContain(value);
    }
  });

  it("serialized ledger entry contains no secret-shaped strings and no env values", () => {
    const report = makeReport();
    const entry = buildLedgerEntry(report, report.agent, report.tokenUsage);
    const json = JSON.stringify(entry, null, 2);
    for (const pattern of SECRET_SHAPED) {
      expect(json, `matched ${pattern}`).not.toMatch(pattern);
    }
    for (const value of Object.values(PLANTED_ENV)) {
      expect(json).not.toContain(value);
    }
  });

  it("agent metadata exposes only package name + version, no author/PII", () => {
    const report = makeReport();
    const keys = Object.keys(report.agent).sort();
    expect(keys).toEqual(["name", "primaryModels", "version"]);
    // The package name is public and non-personal.
    expect(report.agent.name).toBe("@awesome-repo-graph/curator");
    // No email-shaped string anywhere in agent metadata.
    expect(JSON.stringify(report.agent)).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("token usage carries only numbers, enums, and public model names", () => {
    const { tokenUsage } = makeReport();
    for (const row of tokenUsage.byProvider) {
      expect(typeof row.provider).toBe("string");
      expect(["classification", "embeddings"]).toContain(row.stage);
      expect(row.totalTokens === null || typeof row.totalTokens === "number").toBe(true);
      expect(row.estimatedCostUsd === null || typeof row.estimatedCostUsd === "number").toBe(true);
    }
    // Deepseek reported no usage -> null, never zero.
    const deepseek = tokenUsage.byProvider.find((r) => r.provider === "deepseek")!;
    expect(deepseek.totalTokens).toBeNull();
    expect(deepseek.estimatedCostUsd).toBeNull();
  });
});
