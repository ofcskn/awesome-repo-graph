import { z } from "zod";
import { ALL_PROVIDER_NAMES, readBooleanEnv, RUNTIME_ENV_VARS } from "./env.js";
import type { ProviderName } from "./env.js";

const providerNameSchema = z.enum([
  "openai",
  "deepseek",
  "gemini",
  "vertexGemini",
  "ollama",
  "anthropic",
]);

const consensusStrategySchema = z.enum([
  "primary-with-fallback",
  "independent-reviewers",
  "weighted-consensus",
  "disagreement-triggered-review",
  "high-risk-review",
  "taxonomy-only-secondary",
]);

const commitModeSchema = z.enum(["report-only", "commit", "pull-request"]);

// DeepSeek has no embeddings endpoint (confirmed against api-docs.deepseek.com,
// July 2026 — chat/completions/models only), so it's intentionally excluded here.
const embeddingProviderNameSchema = z.enum(["openai", "gemini", "vertexGemini"]);

const configSchema = z
  .object({
    automation: z.object({
      /** 1. Automation enabled state. */
      enabled: z.boolean(),
      /** 2. Dry-run mode (config-level default; CLI/env can force it on). */
      dryRun: z.boolean(),
    }),
    providers: z.object({
      /** 3. Active AI providers. */
      enabled: z.array(providerNameSchema).min(1),
      /** 4. Primary provider. */
      primary: providerNameSchema,
      /** 5. Fallback provider order. */
      fallbackOrder: z.array(providerNameSchema),
      /** 6. Model names. */
      models: z.record(providerNameSchema, z.string().min(1)),
      /** 7. Provider weights (consensus voting). */
      weights: z.record(providerNameSchema, z.number().min(0)),
      /** 8. Provider request limits (per run). */
      requestLimitPerRun: z.record(providerNameSchema, z.number().int().positive()),
      /** 9. Provider timeout values (ms). */
      timeoutMs: z.record(providerNameSchema, z.number().int().positive()),
      /** 10. Maximum retry counts. */
      maxRetries: z.number().int().min(0).max(10),
      /** Multi-model review strategy (spec section MULTI-MODEL REVIEW). */
      consensusStrategy: consensusStrategySchema,
      /** Bounded concurrent provider requests in-flight at once. */
      maxConcurrentRequests: z.number().int().positive(),
    }),
    discovery: z.object({
      /** 11. Daily candidate limit. */
      dailyCandidateLimit: z.number().int().positive(),
      /** 21. Search queries. */
      searchQueries: z.array(z.string().min(1)).min(1),
      /** 22. GitHub topics. */
      githubTopics: z.array(z.string().min(1)),
      /** 23. Preferred programming languages. */
      preferredLanguages: z.array(z.string().min(1)),
      /** 19. Target sectors (top-level taxonomy reuse hints). */
      sectors: z.array(z.string().min(1)),
      /** 20. Target categories. */
      categories: z.array(z.string().min(1)),
      /**
       * Non-GitHub discovery backends. Each platform contributes its own
       * search queries against its own public API (see discovery/*-search.ts)
       * so trending-source discovery isn't limited to GitHub's search index —
       * GitLab covers self-hosted-friendly OSS, Hugging Face covers ML
       * models/spaces, and npm covers the JS/TS package ecosystem.
       */
      platforms: z.object({
        gitlab: z.object({
          enabled: z.boolean(),
          searchQueries: z.array(z.string().min(1)),
        }),
        huggingface: z.object({
          enabled: z.boolean(),
          searchQueries: z.array(z.string().min(1)),
        }),
        npm: z.object({
          enabled: z.boolean(),
          searchQueries: z.array(z.string().min(1)),
        }),
      }),
    }),
    quality: z.object({
      /** 12. Maximum accepted sources per run. */
      maxAcceptedPerRun: z.number().int().positive(),
      /** 13. Minimum star count. */
      minStars: z.number().int().min(0),
      /** 14. Minimum repository age (days). */
      minRepoAgeDays: z.number().int().min(0),
      /** 15. Maximum inactivity period (days since last push). */
      maxInactivityDays: z.number().int().positive(),
      /** 16. Whether forks are allowed. */
      allowForks: z.boolean(),
      /** 17. Whether archived repositories are allowed. */
      allowArchived: z.boolean(),
      /** 18. License allowlist and denylist (SPDX ids; empty allowlist = any not denied). */
      licenseAllowlist: z.array(z.string()),
      licenseDenylist: z.array(z.string()),
      /** 24. Excluded owners. */
      excludedOwners: z.array(z.string()),
      /** 25. Excluded repositories ("owner/repo"). */
      excludedRepos: z.array(z.string()),
      /** 26. Excluded keywords. */
      excludedKeywords: z.array(z.string()),
      /** 27. Minimum classification confidence (0-1). */
      minClassificationConfidence: z.number().min(0).max(1),
      /** 28. Minimum quality score (0-100). */
      minQualityScore: z.number().min(0).max(100),
      /** 29. Consensus threshold (0-1 fraction of weighted agreement required). */
      consensusThreshold: z.number().min(0).max(1),
    }),
    taxonomy: z.object({
      /** 30. Maximum number of new taxonomy paths per run. */
      maxNewPathsPerRun: z.number().int().min(0),
      /** 31. Tag normalization limits. */
      maxNewTagsPerRun: z.number().int().min(0),
      maxTagsPerSource: z.number().int().positive(),
    }),
    /**
     * REJECTED-CANDIDATE MEMORY windows. These were previously hardcoded
     * literals inside run.ts; they're config now so operators can tune how
     * aggressively the curator avoids re-fetching/re-classifying the same
     * candidates without touching code.
     */
    memory: z.object({
      /** How long a mechanically-rejected/duplicate candidate is skipped without re-checking, if nothing about it changed. */
      recentEvaluationWindowDays: z.number().int().positive(),
      /** How long an AI-rejected candidate is skipped before automatic reconsideration (independent of metadata change). */
      aiRejectionReconsiderationDays: z.number().int().positive(),
    }),
    /**
     * Vector-embedding memory (curator/state/embeddings.json). Lets
     * classification prompts stay small and roughly constant-size as
     * sources.json grows — instead of dumping the full tag/taxonomy list
     * every call, we retrieve only the `topK` most semantically similar
     * existing sources per candidate. Also powers real semantic
     * near-duplicate detection in validation/dedupe.ts.
     */
    embeddings: z.object({
      enabled: z.boolean(),
      /** Preferred embedding provider; falls back to any other configured one that supports embeddings. */
      provider: embeddingProviderNameSchema,
      models: z.record(embeddingProviderNameSchema, z.string().min(1)),
      /** Output vector size (MRL-truncated by the provider) — smaller keeps curator/state/embeddings.json compact. */
      dimensions: z.number().int().positive(),
      /** How many nearest existing sources to surface per candidate, replacing the full tag/taxonomy dump. */
      topK: z.number().int().positive(),
      /** Cosine-similarity floor above which two sources are flagged as likely semantic near-duplicates. */
      duplicateSimilarityThreshold: z.number().min(0).max(1),
    }),
    scheduling: z.object({
      /** 32. Scheduling timezone (IANA name). */
      timezone: z.string().min(1),
      /** 33. Configured local execution hour(s) (0-23, in `timezone`). Supports multiple runs per day. */
      executionHours: z.array(z.number().int().min(0).max(23)).min(1),
      /** 34. Minimum interval between successful runs (hours) — prevents double-firing within the same hour. */
      minIntervalHoursBetweenRuns: z.number().int().positive(),
    }),
    output: z.object({
      /** 35. Branch name prefix. */
      branchPrefix: z.string().min(1),
      /** 36 & 37. Commit mode / pull-request mode, unified: one output mode. */
      commitMode: commitModeSchema,
      /** 38. Report output directory. */
      reportDir: z.string().min(1),
      /** 39. Whether reports are committed. */
      commitReports: z.boolean(),
      /**
       * Approved-agent attestation. When a change is committed, the curator
       * signs it (scripts/attest.js) so the approved-agent gate
       * (.github/workflows/verify-agent.yml) accepts the resulting PR. The
       * signing key is supplied only via the AGENT_SIGNING_KEY env var
       * (mapped from the CURATOR_SIGNING_KEY CI secret) — never from config.
       * If `enabled` is true but no key material is present at runtime, the
       * step is skipped with a note rather than failing the run.
       */
      attestation: z.object({
        enabled: z.boolean(),
        agentId: z.string().min(1),
        keyId: z.string().min(1),
      }),
    }),
    maintenance: z.object({
      /** 40. Whether star scores are refreshed. */
      refreshScores: z.boolean(),
      /** 41. Whether the web application is built. */
      buildWebApp: z.boolean(),
      /** 42. Whether browser smoke tests are executed. */
      runSmokeTests: z.boolean(),
    }),
  })
  .strict();

export type CuratorConfig = z.infer<typeof configSchema>;

/**
 * Single source of truth for all non-secret operational behavior.
 * Secrets (API keys) live only in environment variables — see env.ts.
 */
const defaultConfig: CuratorConfig = {
  automation: {
    enabled: true,
    dryRun: false,
  },
  providers: {
    enabled: ["openai", "gemini", "deepseek", "vertexGemini"],
    primary: "openai",
    fallbackOrder: ["gemini", "deepseek", "vertexGemini"],
    models: {
      openai: "gpt-5.5",
      deepseek: "deepseek-v4-pro",
      gemini: "gemini-2.5-flash",
      vertexGemini: "gemini-2.5-flash",
      // Local/self-hosted default: an Ollama model tag. Point OLLAMA_BASE_URL
      // at any OpenAI-compatible server and set this to that server's tag to
      // run Hermes, "OpenClaw", or another local model — no code change.
      ollama: "hermes3",
      anthropic: "claude-opus-4-8",
    },
    weights: {
      openai: 1,
      gemini: 1,
      deepseek: 0.75,
      vertexGemini: 1,
      ollama: 0.6,
      anthropic: 1,
    },
    requestLimitPerRun: {
      openai: 60,
      gemini: 60,
      deepseek: 60,
      vertexGemini: 60,
      ollama: 60,
      anthropic: 60,
    },
    timeoutMs: {
      openai: 30_000,
      gemini: 30_000,
      deepseek: 30_000,
      vertexGemini: 30_000,
      // Local inference can be slower than a hosted API; give it more headroom.
      ollama: 120_000,
      anthropic: 60_000,
    },
    maxRetries: 3,
    consensusStrategy: "primary-with-fallback",
    maxConcurrentRequests: 3,
  },
  discovery: {
    // Scaled for 4 runs/day (scheduling.executionHours below): 10/run x 4
    // runs = 40/day total, matching the original single-run-per-day budget
    // so moving to 4x/day doesn't silently 4x discovery + AI classification cost.
    // Raised from 10: the discovery loop (discovery/index.ts) scans
    // searchQueries/githubTopics in array order and stops once this many
    // candidates are collected, so a low limit combined with the interleaved
    // topics below would let the first query or two exhaust the budget
    // before the new-category topics ever ran.
    // Raised from 24 to 32 when discovery grew from GitHub-only to four
    // platforms (GitHub + GitLab + Hugging Face + npm): the same
    // remaining-budget/remaining-queries split in discovery/index.ts now
    // divides across ~31 query slots instead of ~19, so keeping the old
    // limit would have silently starved the three new platforms down to a
    // handful of candidates each.
    dailyCandidateLimit: 32,
    searchQueries: [
      "topic:ai-agent stars:>200",
      "topic:mcp-server stars:>100",
      "topic:llm-agent-framework stars:>200",
      "topic:developer-tooling stars:>500",
    ],
    // Interleaved (not appended) with the original 5 topics above so a run
    // samples across domains instead of exhausting dailyCandidateLimit on
    // the first one or two queries. Each new-category topic corresponds
    // 1:1 with an entry in `categories` below.
    githubTopics: [
      "ai-agent",
      "rest-api",
      "mcp-server",
      "machine-learning",
      "llm-agent-framework",
      "vector-database",
      "agent-orchestration",
      "appsec",
      "developer-tooling",
      "flutter",
      "serverless",
      "static-analysis",
      "observability",
      "cli",
      "blockchain",
    ],
    preferredLanguages: ["TypeScript", "Python", "Go", "Rust"],
    sectors: ["AI Agent Tooling", "Frontend Engineering", "DevOps & Infrastructure"],
    // Target sectors this run is actively trying to seed (see
    // providers/prompt.ts's "Target categories" prompt section) — new
    // top-level taxonomy paths the classifier should prefer over
    // force-fitting a genuinely-matching candidate into an unrelated
    // existing sector. Bounded by taxonomy.maxNewPathsPerRun /
    // quality.maxAcceptedPerRun, so these seed in gradually across runs
    // rather than all landing in the first one.
    categories: [
      "Backend Engineering & APIs",
      "Machine Learning & Data Science",
      "Databases & Data Engineering",
      "Cybersecurity & Privacy",
      "Mobile App Development",
      "Cloud Platforms & Serverless",
      "Testing & Code Quality",
      "Observability & Reliability",
      "Developer Productivity & CLI Tools",
      "Web3 & Distributed Systems",
    ],
    platforms: {
      gitlab: {
        enabled: true,
        searchQueries: [
          "ai agent",
          "mcp server",
          "developer tooling",
          "observability",
        ],
      },
      huggingface: {
        enabled: true,
        searchQueries: [
          "agent",
          "rag",
          "mcp",
          "text-generation",
        ],
      },
      npm: {
        enabled: true,
        searchQueries: [
          "ai-agent",
          "mcp-server",
          "llm-tooling",
          "cli-framework",
        ],
      },
    },
  },
  quality: {
    // Same 4-runs/day scaling as discovery.dailyCandidateLimit: 2/run x 4 = 8/day.
    maxAcceptedPerRun: 2,
    minStars: 50,
    minRepoAgeDays: 30,
    maxInactivityDays: 365,
    allowForks: false,
    allowArchived: false,
    licenseAllowlist: [],
    licenseDenylist: ["NOASSERTION"],
    excludedOwners: [],
    excludedRepos: [],
    excludedKeywords: ["tutorial-only", "coursework", "homework"],
    minClassificationConfidence: 0.7,
    minQualityScore: 60,
    consensusThreshold: 0.66,
  },
  taxonomy: {
    maxNewPathsPerRun: 2,
    maxNewTagsPerRun: 6,
    maxTagsPerSource: 6,
  },
  memory: {
    recentEvaluationWindowDays: 7,
    aiRejectionReconsiderationDays: 14,
  },
  embeddings: {
    enabled: true,
    provider: "vertexGemini",
    models: {
      openai: "text-embedding-3-small",
      gemini: "gemini-embedding-001",
      vertexGemini: "gemini-embedding-001",
    },
    // 256 dims keeps curator/state/embeddings.json compact at scale while
    // retaining ~97%+ of full-precision retrieval quality (both OpenAI and
    // Gemini support server-side MRL truncation via this exact param name/value).
    dimensions: 256,
    topK: 8,
    duplicateSimilarityThreshold: 0.93,
  },
  scheduling: {
    timezone: "UTC",
    // 4 runs/day, evenly spaced. The GitHub Actions cron fires hourly;
    // scheduling.ts only lets a run proceed when the current UTC hour is
    // in this list (or --force is passed).
    executionHours: [0, 6, 12, 18],
    // Must be comfortably less than the spacing between executionHours (6h)
    // so each scheduled hour actually fires, but long enough to absorb a
    // cron tick landing a few minutes late/early without double-running.
    minIntervalHoursBetweenRuns: 5,
  },
  output: {
    branchPrefix: "curator/auto",
    commitMode: "pull-request",
    reportDir: "curator/reports",
    commitReports: true,
    attestation: {
      enabled: true,
      agentId: "awesome-repo-graph-curator",
      keyId: "curator-2026",
    },
  },
  maintenance: {
    refreshScores: true,
    buildWebApp: true,
    runSmokeTests: false,
  },
};

export interface LoadConfigOverrides {
  dryRun?: boolean;
  force?: boolean;
  /**
   * Forces a provider to be primary for this run (used by the local trigger,
   * e.g. `--provider ollama`). The provider is added to `providers.enabled`
   * if it isn't already, so a local-only provider can drive a run without
   * editing config.ts. Never persisted.
   */
  primaryProvider?: ProviderName;
  /** Overrides `output.commitMode` for this run (the local trigger defaults to "pull-request"). Never persisted. */
  commitMode?: CuratorConfig["output"]["commitMode"];
}

export interface LoadedConfig {
  config: CuratorConfig;
  /** Effective dry-run, after CLI flag / env var overrides are applied. */
  dryRun: boolean;
  /** Effective force flag — bypasses the daily scheduling gate. Never persisted. */
  force: boolean;
  /** Stable hash of the config used for the audit report's "configuration fingerprint". */
  fingerprint: string;
}

function computeFingerprint(config: CuratorConfig): string {
  // Deterministic, order-independent-enough for our nested-object shape (JSON.stringify
  // preserves key insertion order, which is stable because defaultConfig's key order
  // never changes at runtime).
  const json = JSON.stringify(config);
  let hash = 0;
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash * 31 + json.charCodeAt(i)) | 0;
  }
  return `cfg_${(hash >>> 0).toString(16)}`;
}

/**
 * Loads and validates the static config, applying only the two runtime
 * overrides the spec permits from outside config.ts (CLI flags / CI inputs):
 * dry-run and force. Throws on schema violations so bad config fails fast.
 */
export function loadConfig(overrides: LoadConfigOverrides = {}): LoadedConfig {
  const config = configSchema.parse(defaultConfig);

  // Local-trigger overrides (force a primary provider / output mode) are
  // applied before the invariant checks below, so a forced provider is a
  // valid primary and the fingerprint reflects the effective config.
  if (overrides.primaryProvider) {
    const forced = overrides.primaryProvider;
    if (!config.providers.enabled.includes(forced)) {
      config.providers.enabled = [...config.providers.enabled, forced];
    }
    config.providers.primary = forced;
  }
  if (overrides.commitMode) {
    config.output.commitMode = overrides.commitMode;
  }

  for (const provider of config.providers.enabled) {
    if (!ALL_PROVIDER_NAMES.includes(provider as ProviderName)) {
      throw new Error(`config.ts: unknown provider "${provider}" in providers.enabled`);
    }
  }
  if (!config.providers.enabled.includes(config.providers.primary)) {
    throw new Error("config.ts: providers.primary must be included in providers.enabled");
  }

  const envDryRun = readBooleanEnv(RUNTIME_ENV_VARS.dryRun);
  const envForce = readBooleanEnv(RUNTIME_ENV_VARS.force);

  const dryRun = overrides.dryRun ?? envDryRun ?? config.automation.dryRun;
  const force = overrides.force ?? envForce ?? false;

  return {
    config,
    dryRun,
    force,
    fingerprint: computeFingerprint(config),
  };
}

export { configSchema };
export type { ProviderName };
