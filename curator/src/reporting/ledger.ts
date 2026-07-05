import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderName } from "../env.js";
import type { PipelineStage, TokenAccountingSummary } from "./token-accounting.js";
import type { RunReport } from "./report.js";

const reportingDir = fileURLToPath(new URL(".", import.meta.url));
/** Committed, append-only run/token ledger — survives ephemeral CI runners. */
export const TOKEN_LEDGER_PATH = path.resolve(reportingDir, "..", "..", "state", "token-ledger.json");

/**
 * Rotation cap: keep only the most recent N runs. At the shipped cadence of
 * 4 runs/day this is ~125 days of history — enough for cost trending while
 * keeping the file bounded. Oldest rows are dropped on write.
 */
export const MAX_LEDGER_ENTRIES = 500;

export interface LedgerProviderUsage {
  provider: ProviderName;
  stage: PipelineStage;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
}

/** One sanitized row per run. Holds no secrets, no PII, no provider payloads. */
export interface TokenLedgerEntry {
  runId: string;
  /** ISO start time — the unique key within the ledger. */
  startedAt: string;
  completedAt: string;
  status: RunReport["status"];
  agentName: string;
  agentVersion: string;
  primaryModels: string[];
  acceptedCount: number;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  byProvider: LedgerProviderUsage[];
}

export interface TokenLedger {
  entries: TokenLedgerEntry[];
}

export function loadLedger(ledgerPath: string = TOKEN_LEDGER_PATH): TokenLedger {
  if (!fs.existsSync(ledgerPath)) return { entries: [] };
  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    const data = JSON.parse(raw) as { entries?: TokenLedgerEntry[] };
    return { entries: Array.isArray(data.entries) ? data.entries : [] };
  } catch {
    return { entries: [] };
  }
}

/**
 * Returns a new ledger with `entry` appended. Pure (does no I/O):
 *
 * - Idempotent: an entry with the same `startedAt` replaces the existing one
 *   instead of duplicating it, so a retried run does not double-count.
 * - Sorted ascending by `startedAt` (then `runId`) so writes append at the
 *   end and diffs stay clean.
 * - Bounded: trimmed to the most recent `MAX_LEDGER_ENTRIES` rows.
 */
export function appendLedgerEntry(
  ledger: TokenLedger,
  entry: TokenLedgerEntry,
  maxEntries: number = MAX_LEDGER_ENTRIES,
): TokenLedger {
  const deduped = ledger.entries.filter((existing) => existing.startedAt !== entry.startedAt);
  deduped.push(entry);
  deduped.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));
  const trimmed = deduped.length > maxEntries ? deduped.slice(deduped.length - maxEntries) : deduped;
  return { entries: trimmed };
}

export function writeLedger(ledger: TokenLedger, ledgerPath: string = TOKEN_LEDGER_PATH): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** Projects a finished report + token summary into a sanitized ledger row. */
export function buildLedgerEntry(
  report: RunReport,
  agent: { name: string; version: string; primaryModels: string[] },
  tokenUsage: TokenAccountingSummary,
): TokenLedgerEntry {
  return {
    runId: report.runId,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    status: report.status,
    agentName: agent.name,
    agentVersion: agent.version,
    primaryModels: agent.primaryModels,
    acceptedCount: report.counts.accepted,
    totalTokens: tokenUsage.totalTokens,
    estimatedCostUsd: tokenUsage.estimatedCostUsd,
    byProvider: tokenUsage.byProvider.map((row) => ({
      provider: row.provider,
      stage: row.stage,
      totalTokens: row.totalTokens,
      estimatedCostUsd: row.estimatedCostUsd,
    })),
  };
}

/** Loads, appends, and persists in one step. Returns the entry that was written. */
export function recordRunInLedger(
  report: RunReport,
  agent: { name: string; version: string; primaryModels: string[] },
  tokenUsage: TokenAccountingSummary,
  ledgerPath: string = TOKEN_LEDGER_PATH,
): TokenLedgerEntry {
  const entry = buildLedgerEntry(report, agent, tokenUsage);
  const next = appendLedgerEntry(loadLedger(ledgerPath), entry);
  writeLedger(next, ledgerPath);
  return entry;
}
