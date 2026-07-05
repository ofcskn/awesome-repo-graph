#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { getAllCredentialStatuses, validateProviderEnv } from "./env.js";
import { runPipeline } from "./run.js";
import { resolveEmbeddingProvider } from "./embeddings/providers.js";
import { loadEmbeddingStore, syncEmbeddings } from "./memory/embedding-store.js";
import { loadSources } from "./store-bridge.js";

function parseFlags(argv: string[]) {
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    scheduled: argv.includes("--scheduled"),
  };
}

async function runValidateEnv(): Promise<void> {
  const { config } = loadConfig({});
  const statuses = getAllCredentialStatuses();

  console.log("Provider credential status:");
  for (const status of statuses) {
    console.log(`  ${status.provider} (${status.envVar}): ${status.present ? "present" : "MISSING"}`);
  }

  const result = validateProviderEnv(config.providers.enabled);
  if (!result.ok) {
    console.error("\nEnvironment validation FAILED:");
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nEnvironment OK — ${result.enabledProviders.length} provider(s) usable: ${result.enabledProviders.join(", ")}`,
  );
  if (result.disabledProviders.length > 0) {
    console.log("Disabled (missing credentials):");
    for (const d of result.disabledProviders) console.log(`  - ${d.provider} (${d.envVar})`);
  }
}

async function runCommand(flags: ReturnType<typeof parseFlags>): Promise<void> {
  const report = await runPipeline({
    dryRun: flags.dryRun ? true : undefined,
    force: flags.force ? true : undefined,
    respectSchedule: flags.scheduled,
  });

  console.log(`Run ${report.runId} — status=${report.status}`);
  console.log(
    `  discovered=${report.counts.discovered} mechanicallyRejected=${report.counts.mechanicallyRejected} ` +
      `sentToAiReview=${report.counts.sentToAiReview} accepted=${report.counts.accepted} ` +
      `rejected=${report.counts.rejected} deferred=${report.counts.deferred}`,
  );
  if (report.notes.length > 0) {
    console.log("Notes:");
    for (const note of report.notes) console.log(`  - ${note}`);
  }

  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

/**
 * Manual full backfill/repair of curator/state/embeddings.json — normally
 * unnecessary since `run` keeps it in sync incrementally, but useful after
 * changing config.embeddings.provider/model/dimensions (which invalidates
 * every cached vector) or if the state file was deleted/corrupted.
 */
async function runEmbeddingsSync(): Promise<void> {
  const { config } = loadConfig({});
  const provider = resolveEmbeddingProvider(config);
  if (!provider) {
    console.error(
      "No embedding-capable provider (openai/gemini/vertexGemini) has credentials — nothing to sync.",
    );
    process.exitCode = 1;
    return;
  }

  const { sources } = loadSources();
  const model = config.embeddings.models[provider.name]!;
  const { result } = await syncEmbeddings(
    sources,
    loadEmbeddingStore(),
    provider,
    model,
    config.embeddings.dimensions,
    true,
  );
  console.log(
    `Embedding sync (${provider.name}/${model}): embedded ${result.embedded}, ` +
      `skipped ${result.skipped} (unchanged), pruned ${result.removed} (stale).`,
  );
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const flags = parseFlags(rest);

  if (command === "validate-env") {
    await runValidateEnv();
    return;
  }
  if (command === "run") {
    await runCommand(flags);
    return;
  }
  if (command === "embeddings-sync") {
    await runEmbeddingsSync();
    return;
  }

  console.error("Usage: cli.ts <run|validate-env|embeddings-sync> [--dry-run] [--force] [--scheduled]");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
