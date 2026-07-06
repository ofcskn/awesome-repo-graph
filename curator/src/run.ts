import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type LoadConfigOverrides } from "./config.js";
import { discoverCandidates } from "./discovery/index.js";
import { verifyUrlReachable, mechanicalValidate } from "./validation/mechanical.js";
import { findDuplicates } from "./validation/dedupe.js";
import { getExistingTaxonomyPaths, TaxonomyBudget } from "./classification/taxonomy.js";
import { getExistingTags, normalizeAndCapTags, TagBudget } from "./classification/tags.js";
import { runClassification } from "./classification/consensus.js";
import { createProviderRegistry, getEnabledProviders } from "./providers/index.js";
import { insertSource } from "./insertion/insert.js";
import { refreshScores } from "./insertion/score-refresh.js";
import { buildWebApp, runSmokeTests } from "./maintenance.js";
import {
  buildRejectionRecord,
  checkReconsideration,
  isTransientRejection,
  loadRejectionHistory,
  REJECTION_STATE_PATH,
  saveRejectionHistory,
  upsertRejection,
} from "./memory/rejection-store.js";
import { evaluateSchedulingGate, saveLastRunState } from "./scheduling.js";
import { loadSources, type StoredSource } from "./store-bridge.js";
import { createRunId, writeReport, type RunReport } from "./reporting/report.js";
import { TokenAccumulator, emptyTokenSummary } from "./reporting/token-accounting.js";
import { readAgentMetadata } from "./reporting/agent.js";
import { recordRunInLedger, TOKEN_LEDGER_PATH } from "./reporting/ledger.js";
import {
  checkoutBranch,
  createOrUpdatePullRequest,
  dispatchWorkflow,
  ensureBranch,
  getCurrentBranch,
  getDefaultBranch,
  pushBranch,
  stageAndCommit,
} from "./git/branch.js";
import { generateAttestation } from "./git/attest.js";
import { resolveEmbeddingProvider } from "./embeddings/providers.js";
import { findNearest } from "./embeddings/similarity.js";
import {
  candidateEmbeddingText,
  embedAndStoreOne,
  EMBEDDING_STATE_PATH,
  loadEmbeddingStore,
  syncEmbeddings,
  type EmbeddingRecord,
} from "./memory/embedding-store.js";
import { selectRelatedSourcesByTopic } from "./providers/prompt.js";
import type { EmbeddingDuplicateContext } from "./validation/dedupe.js";
import type { ExistingSourceSummary, RejectionReasonCode } from "./types.js";

/**
 * Deploy workflow to dispatch after a direct "commit" push lands on the
 * default branch. Only used in commitMode "commit" — pull-request mode
 * relies on GitHub's normal push-triggered deploy once a human merges the
 * PR, so no extra dispatch is needed (or wanted: dispatching before merge
 * would just rebuild the still-unchanged default branch).
 */
const DEPLOY_WORKFLOW_FILE = "deploy-pages.yml";

const curatorSrcDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(curatorSrcDir, "..", "..");

function toExistingSourceSummary(source: StoredSource): ExistingSourceSummary {
  return { id: source.id, url: source.url, path: source.path, tags: source.tags };
}

const DUPLICATE_MATCH_TO_REASON: Record<string, RejectionReasonCode> = {
  "exact-url": "duplicate-of-existing",
  "duplicate-id": "duplicate-of-existing",
  "owner-repo": "renamed-duplicate",
  "redirect-canonical": "duplicate-of-existing",
  "github-id": "duplicate-of-existing",
  "fork-parent": "fork-of-existing-source",
  mirror: "same-project-alt-url",
  "homepage-similarity": "same-project-alt-url",
  "title-similarity": "same-project-alt-url",
  "semantic-near-duplicate": "same-project-alt-url",
  "previously-rejected": "recently-evaluated",
};

export interface RunOptions extends LoadConfigOverrides {
  /** true only for the scheduled (cron/workflow_dispatch) entry point. */
  respectSchedule: boolean;
}

export async function runPipeline(options: RunOptions): Promise<RunReport> {
  const startedAt = new Date();
  const loaded = loadConfig(options);
  const { config, dryRun, force, fingerprint } = loaded;
  const runId = createRunId(startedAt);

  // Aggregates the per-call token counts the provider layer already reports
  // into per-run, per-stage, per-provider totals. Holds only numbers and
  // public model names — never secrets, prompts, or provider payloads.
  const tokens = new TokenAccumulator();
  const agentMeta = readAgentMetadata();

  const report: RunReport = {
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: "",
    status: "failed",
    configFingerprint: fingerprint,
    agent: { name: agentMeta.name, version: agentMeta.version, primaryModels: [] },
    tokenUsage: emptyTokenSummary(),
    activeProviders: [],
    disabledProviders: [],
    searchQueries: config.discovery.searchQueries,
    discoveryMethods: [],
    counts: { discovered: 0, mechanicallyRejected: 0, sentToAiReview: 0, accepted: 0, rejected: 0, deferred: 0 },
    acceptedSourceUrls: [],
    finalTaxonomyPaths: [],
    finalTags: [],
    rejectionReasonCounts: {},
    duplicateMatches: [],
    providerDisagreements: [],
    providerFailures: [],
    retryCounts: {},
    filesChanged: [],
    commandsExecuted: [],
    scoreRefresh: null,
    validation: { readmeGenerated: false, sourcesJsonValid: true, errors: [] },
    build: { ran: false, succeeded: true, error: null },
    output: {
      mode: dryRun ? "dry-run" : config.output.commitMode,
      commit: null,
      pullRequest: null,
      pagesDeployDispatch: null,
    },
    notes: [],
  };

  function tallyRejection(reason: RejectionReasonCode) {
    report.rejectionReasonCounts[reason] = (report.rejectionReasonCounts[reason] ?? 0) + 1;
  }

  if (!config.automation.enabled && !force) {
    report.status = "skipped";
    report.completedAt = new Date().toISOString();
    report.notes.push("automation.enabled is false in config.ts");
    writeReport(report, config.output.reportDir, repoRoot);
    return report;
  }

  if (options.respectSchedule) {
    const gate = evaluateSchedulingGate(config, force, startedAt);
    if (!gate.shouldRun) {
      report.status = "skipped";
      report.completedAt = new Date().toISOString();
      report.notes.push(`Scheduling gate: ${gate.reason}`);
      writeReport(report, config.output.reportDir, repoRoot);
      return report;
    }
    report.notes.push(`Scheduling gate: ${gate.reason}`);
  }

  const registry = createProviderRegistry();
  const { providers, disabledProviders, warnings } = getEnabledProviders(config, registry);
  report.activeProviders = providers.map((p) => p.name);
  report.disabledProviders = disabledProviders;
  report.notes.push(...warnings);

  if (providers.length === 0) {
    report.status = "failed";
    report.completedAt = new Date().toISOString();
    report.notes.push(
      "No enabled AI provider has valid credentials. Discovery was not started (fail-closed per spec).",
    );
    writeReport(report, config.output.reportDir, repoRoot);
    return report;
  }

  const existingData = loadSources();
  const existingTaxonomyPaths = getExistingTaxonomyPaths(existingData.sources);
  const existingTags = getExistingTags(existingData.sources);
  const existingSourceSummaries = existingData.sources.map(toExistingSourceSummary);

  const discovery = await discoverCandidates(config);
  report.counts.discovered = discovery.candidates.length;
  report.discoveryMethods = discovery.queriesRun;
  if (discovery.rateLimitedQueries.length > 0) {
    report.notes.push(`Rate-limited search queries: ${discovery.rateLimitedQueries.join(", ")}`);
  }
  const platformSummary = Object.entries(discovery.platformCounts)
    .map(([platform, count]) => `${platform}=${count}`)
    .join(", ");
  if (platformSummary) {
    report.notes.push(`Candidates by platform: ${platformSummary}`);
  }

  let rejectionHistory = loadRejectionHistory();
  const taxonomyBudget = new TaxonomyBudget(existingTaxonomyPaths, config.taxonomy.maxNewPathsPerRun);
  const tagBudget = new TagBudget(existingTags, config.taxonomy.maxNewTagsPerRun);
  const filesChanged = new Set<string>();
  const configFingerprint = report.configFingerprint;

  // Vector-embedding memory: keeps classification prompts small and
  // roughly constant-size as sources.json grows, by retrieving only the
  // `topK` most semantically similar existing sources per candidate
  // instead of dumping the full catalog into every call. Also powers the
  // semantic-near-duplicate check in findDuplicates(). Purely additive —
  // falls back to the topic-overlap heuristic when no embedding provider
  // is configured/available (see providers/prompt.ts).
  const embeddingProvider = resolveEmbeddingProvider(config);
  let embeddingRecords: EmbeddingRecord[] = [];
  if (embeddingProvider) {
    const embeddingModel = config.embeddings.models[embeddingProvider.name]!;
    // Register the embeddings stage so it appears in the token report with
    // its provider + model. The embedding adapters do not surface SDK usage
    // today, so tokens are recorded as null (unknown), never zero.
    tokens.record("embeddings", embeddingProvider.name, embeddingModel, null);
    const sync = await syncEmbeddings(
      existingData.sources,
      loadEmbeddingStore(),
      embeddingProvider,
      embeddingModel,
      config.embeddings.dimensions,
      !dryRun,
    );
    embeddingRecords = sync.store;
    if (sync.result.embedded > 0 || sync.result.removed > 0) {
      report.notes.push(
        `Embedding memory sync (${embeddingProvider.name}): embedded ${sync.result.embedded} new/changed, ` +
          `skipped ${sync.result.skipped} unchanged, pruned ${sync.result.removed} stale.`,
      );
      if (!dryRun) filesChanged.add(path.relative(repoRoot, EMBEDDING_STATE_PATH));
    }
  } else if (config.embeddings.enabled) {
    report.notes.push(
      "Embedding memory disabled for this run: no configured provider (openai/gemini/vertexGemini) has credentials — falling back to the topic-overlap heuristic for related-source context.",
    );
  }

  for (const candidate of discovery.candidates) {
    if (report.counts.accepted >= config.quality.maxAcceptedPerRun) break;

    const reconsideration = checkReconsideration(
      rejectionHistory,
      candidate,
      configFingerprint,
      config.memory.recentEvaluationWindowDays,
    );
    if (reconsideration.shouldSkip) {
      report.counts.mechanicallyRejected += 1;
      tallyRejection("recently-evaluated");
      continue;
    }

    let candidateEmbedding: number[] | null = null;
    if (embeddingProvider) {
      try {
        const [vector] = await embeddingProvider.embed([candidateEmbeddingText(candidate)]);
        candidateEmbedding = vector ?? null;
      } catch (error) {
        report.notes.push(
          `Embedding failed for ${candidate.canonicalUrl}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const embeddingDuplicateContext: EmbeddingDuplicateContext | null =
      candidateEmbedding && embeddingRecords.length > 0
        ? {
            candidateEmbedding,
            existingEmbeddings: embeddingRecords.map((r) => ({ sourceId: r.sourceId, vector: r.vector })),
            threshold: config.embeddings.duplicateSimilarityThreshold,
          }
        : null;

    const duplicates = await findDuplicates(
      candidate,
      existingData.sources,
      rejectionHistory,
      config.quality.allowForks,
      embeddingDuplicateContext,
    );
    if (duplicates.length > 0) {
      report.duplicateMatches.push(
        ...duplicates.map((d) => ({
          candidateUrl: d.candidateUrl,
          existingSourceId: d.existingSourceId,
          matchType: d.matchType,
        })),
      );
      const reason = DUPLICATE_MATCH_TO_REASON[duplicates[0]!.matchType] ?? "duplicate-of-existing";
      report.counts.mechanicallyRejected += 1;
      tallyRejection(reason);
      if (!isTransientRejection(reason)) {
        rejectionHistory = upsertRejection(
          rejectionHistory,
          buildRejectionRecord(candidate, reason, configFingerprint, null),
        );
      }
      continue;
    }

    const reachable = await verifyUrlReachable(candidate.canonicalUrl);
    const mechanical = mechanicalValidate(candidate, config, reachable);
    if (!mechanical.passed) {
      report.counts.mechanicallyRejected += 1;
      for (const reason of mechanical.reasons) tallyRejection(reason);
      const primaryReason = mechanical.reasons[0]!;
      if (!isTransientRejection(primaryReason)) {
        rejectionHistory = upsertRejection(
          rejectionHistory,
          buildRejectionRecord(candidate, primaryReason, configFingerprint, null),
        );
      }
      continue;
    }

    report.counts.sentToAiReview += 1;

    const relatedSources: ExistingSourceSummary[] =
      candidateEmbedding && embeddingRecords.length > 0
        ? findNearest(
            candidateEmbedding,
            embeddingRecords.map((r) => ({ vector: r.vector, item: r })),
            config.embeddings.topK,
          )
            .map((match) => existingSourceSummaries.find((s) => s.id === match.item.sourceId))
            .filter((s): s is ExistingSourceSummary => s !== undefined)
        : selectRelatedSourcesByTopic(candidate, existingSourceSummaries);

    const consensus = await runClassification(
      candidate,
      { existingTaxonomyPaths, existingTags, existingSources: relatedSources, config },
      providers,
    );

    for (const attempt of consensus.perProvider) {
      if (attempt.error) {
        report.providerFailures.push({
          candidateUrl: candidate.canonicalUrl,
          provider: attempt.provider,
          error: attempt.error,
        });
      }
      report.retryCounts[attempt.provider] = (report.retryCounts[attempt.provider] ?? 0) + attempt.attempts;
      tokens.record(
        "classification",
        attempt.provider,
        config.providers.models[attempt.provider] ?? null,
        attempt.totalTokens,
      );
    }
    if (consensus.disagreements.length > 0) {
      report.providerDisagreements.push({
        candidateUrl: candidate.canonicalUrl,
        disagreements: consensus.disagreements,
      });
    }

    if (consensus.deferred) {
      report.counts.deferred += 1;
      continue;
    }

    if (!consensus.accepted || !consensus.finalClassification) {
      report.counts.rejected += 1;
      const reasons =
        consensus.rejectionReasons.length > 0 ? consensus.rejectionReasons : (["low-quality-score"] as RejectionReasonCode[]);
      for (const reason of reasons) tallyRejection(reason);
      rejectionHistory = upsertRejection(
        rejectionHistory,
        buildRejectionRecord(candidate, reasons[0]!, configFingerprint, config.memory.aiRejectionReconsiderationDays),
      );
      continue;
    }

    const taxonomyResolution = taxonomyBudget.resolve(consensus.finalClassification.taxonomyPath);
    const cappedTags = normalizeAndCapTags(
      consensus.finalClassification.tags,
      existingTags,
      config.taxonomy.maxTagsPerSource,
    );
    const tagResolution = tagBudget.apply(cappedTags);
    const finalClassification = {
      ...consensus.finalClassification,
      taxonomyPath: taxonomyResolution.path,
      tags: tagResolution.tags,
    };
    if (taxonomyResolution.limited || tagResolution.limited) {
      report.notes.push(
        `Taxonomy/tag budget limited candidate ${candidate.canonicalUrl}: ` +
          `${taxonomyResolution.limited ? "taxonomy path narrowed to existing parent; " : ""}` +
          `${tagResolution.limited ? "excess new tags dropped." : ""}`,
      );
    }

    const insertion = await insertSource(candidate, finalClassification, dryRun);
    report.commandsExecuted.push(
      `${dryRun ? "(dry-run) " : ""}node scripts/add-source.js --url ${candidate.canonicalUrl} --path "${finalClassification.taxonomyPath.join(">")}"`,
    );

    if (!insertion.succeeded) {
      report.counts.rejected += 1;
      tallyRejection("insertion-failed");
      report.notes.push(`Insertion failed for ${candidate.canonicalUrl}: ${insertion.error}`);
      continue;
    }

    report.counts.accepted += 1;
    report.acceptedSourceUrls.push(candidate.canonicalUrl);
    report.finalTaxonomyPaths.push(finalClassification.taxonomyPath);
    report.finalTags.push(...finalClassification.tags);
    if (!dryRun) {
      filesChanged.add("sources.json");
      filesChanged.add("README.MD");

      if (embeddingProvider && insertion.sourceId) {
        const insertedRecord = loadSources().sources.find((s) => s.id === insertion.sourceId);
        if (insertedRecord) {
          try {
            embeddingRecords = await embedAndStoreOne(
              insertedRecord,
              embeddingProvider,
              config.embeddings.models[embeddingProvider.name]!,
              config.embeddings.dimensions,
              embeddingRecords,
            );
            filesChanged.add(path.relative(repoRoot, EMBEDDING_STATE_PATH));
          } catch (error) {
            report.notes.push(
              `Failed to embed newly-inserted source ${insertion.sourceId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }
  }

  saveRejectionHistory(rejectionHistory);
  if (!dryRun) filesChanged.add(path.relative(repoRoot, REJECTION_STATE_PATH));

  if (report.counts.accepted > 0 && config.maintenance.refreshScores) {
    report.scoreRefresh = await refreshScores(dryRun);
    if (!dryRun && report.scoreRefresh.succeeded) filesChanged.add("sources.json");
  }

  if (config.maintenance.buildWebApp && !dryRun) {
    report.build = await buildWebApp(true);
  }
  if (config.maintenance.runSmokeTests && !dryRun) {
    const smoke = await runSmokeTests(true, report.acceptedSourceUrls);
    if (!smoke.succeeded) report.notes.push(`Smoke tests failed: ${smoke.error ?? "see checks"}`);
  }

  // Finalize token accounting + sanitized agent metadata before the git
  // step, so the ledger can be staged alongside any accepted-source commit.
  report.tokenUsage = tokens.summarize();
  report.agent.primaryModels = tokens.modelsUsed();
  report.status = report.counts.accepted > 0 || report.counts.discovered === 0 ? "success" : "partial";
  report.completedAt = new Date().toISOString();

  if (!dryRun) {
    // Append one sanitized row to the committed run/token ledger. It's
    // written every run but only *committed* when the run also commits
    // sources (the git step below only runs on accepted > 0), preserving the
    // "no git activity on zero accepts" invariant.
    recordRunInLedger(report, report.agent, report.tokenUsage);
    filesChanged.add(path.relative(repoRoot, TOKEN_LEDGER_PATH));
  }

  const hasChanges = report.counts.accepted > 0 && !dryRun;
  if (hasChanges && config.output.commitMode !== "report-only") {
    const dateStr = startedAt.toISOString().slice(0, 10);
    const branch = `${config.output.branchPrefix}/${dateStr}`;
    const commitMessage = `Add ${report.counts.accepted} curated source(s) (${dateStr})`;
    const filesList = Array.from(filesChanged).filter(Boolean);

    // Sign the change so the resulting PR passes the approved-agent gate.
    // Runs after all insertions (sources.json/README.MD are already on disk)
    // and before staging, so the attestation lands in the same commit.
    // Fail-open: with no signing key present it's skipped, not failed.
    if (config.output.attestation.enabled) {
      const attestation = await generateAttestation({
        agentId: config.output.attestation.agentId,
        keyId: config.output.attestation.keyId,
      });
      if (attestation.created && attestation.path) {
        filesList.push(attestation.path);
        filesChanged.add(attestation.path);
      } else if (attestation.skipped) {
        report.notes.push("Attestation skipped: no signing key (AGENT_SIGNING_KEY) present.");
      } else if (attestation.error) {
        report.notes.push(`Attestation failed: ${attestation.error}`);
      }
    }

    try {
      if (config.output.commitMode === "pull-request") {
        const startingBranch = await getCurrentBranch();
        await ensureBranch(branch);
        const commit = await stageAndCommit(filesList, commitMessage);
        report.output.commit = commit;
        if (commit.committed) {
          const pushResult = await pushBranch(branch);
          if (pushResult.pushed) {
            const base = await getDefaultBranch();
            report.output.pullRequest = await createOrUpdatePullRequest(
              branch,
              base,
              commitMessage,
              buildPullRequestBody(report),
            );
          } else {
            report.notes.push(`Push failed: ${pushResult.error}`);
          }
        }
        await checkoutBranch(startingBranch);
      } else if (config.output.commitMode === "commit") {
        const commit = await stageAndCommit(filesList, commitMessage);
        report.output.commit = commit;
        if (commit.committed) {
          const currentBranch = await getCurrentBranch();
          const pushResult = await pushBranch(currentBranch);
          if (!pushResult.pushed) {
            report.notes.push(`Push failed: ${pushResult.error}`);
          } else {
            // Pushes made with the workflow's own GITHUB_TOKEN do not
            // trigger other workflows' `on: push` (GitHub's built-in loop
            // guard), so deploy-pages.yml would otherwise never run after
            // a direct commit. This is a one-shot workflow_dispatch call —
            // deploy-pages.yml never calls back into curate.yml — so it
            // cannot create a cycle.
            report.output.pagesDeployDispatch = await dispatchWorkflow(DEPLOY_WORKFLOW_FILE, currentBranch);
            if (!report.output.pagesDeployDispatch.dispatched) {
              report.notes.push(`Pages deploy dispatch failed: ${report.output.pagesDeployDispatch.error}`);
            }
          }
        }
      }
    } catch (error) {
      report.notes.push(`Git/PR step failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  report.filesChanged = Array.from(filesChanged).filter(Boolean);

  if (!dryRun) {
    saveLastRunState({ lastSuccessAt: report.completedAt });
  }

  writeReport(report, config.output.reportDir, repoRoot);
  return report;
}

function buildPullRequestBody(report: RunReport): string {
  const lines = [
    `Automated curation run \`${report.runId}\`.`,
    "",
    `- Discovered: ${report.counts.discovered}`,
    `- Mechanically rejected: ${report.counts.mechanicallyRejected}`,
    `- Sent to AI review: ${report.counts.sentToAiReview}`,
    `- Accepted: ${report.counts.accepted}`,
    `- Rejected: ${report.counts.rejected}`,
    `- Deferred: ${report.counts.deferred}`,
    "",
    "Accepted sources:",
    ...report.acceptedSourceUrls.map((url) => `- ${url}`),
  ];
  if (report.providerFailures.length > 0) {
    lines.push("", "Provider failures:", ...report.providerFailures.map((f) => `- ${f.provider}: ${f.error}`));
  }
  return lines.join("\n");
}
