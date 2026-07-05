import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendLedgerEntry,
  buildLedgerEntry,
  loadLedger,
  recordRunInLedger,
  writeLedger,
  type TokenLedger,
  type TokenLedgerEntry,
} from "../src/reporting/ledger.js";
import { TokenAccumulator } from "../src/reporting/token-accounting.js";
import type { RunReport } from "../src/reporting/report.js";

function entry(startedAt: string, overrides: Partial<TokenLedgerEntry> = {}): TokenLedgerEntry {
  return {
    runId: startedAt.slice(0, 10),
    startedAt,
    completedAt: startedAt,
    status: "success",
    agentName: "@awesome-repo-graph/curator",
    agentVersion: "1.0.0",
    primaryModels: ["gpt-5.5"],
    acceptedCount: 1,
    totalTokens: 100,
    estimatedCostUsd: 0.0005,
    byProvider: [],
    ...overrides,
  };
}

describe("appendLedgerEntry", () => {
  it("appends and keeps entries sorted ascending by startedAt", () => {
    let ledger: TokenLedger = { entries: [] };
    ledger = appendLedgerEntry(ledger, entry("2026-07-03T00:00:00.000Z"));
    ledger = appendLedgerEntry(ledger, entry("2026-07-01T00:00:00.000Z"));
    ledger = appendLedgerEntry(ledger, entry("2026-07-02T00:00:00.000Z"));
    expect(ledger.entries.map((e) => e.startedAt)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z",
    ]);
  });

  it("is idempotent on startedAt: re-appending replaces rather than duplicates", () => {
    let ledger: TokenLedger = { entries: [] };
    ledger = appendLedgerEntry(ledger, entry("2026-07-01T06:00:00.000Z", { acceptedCount: 1 }));
    ledger = appendLedgerEntry(ledger, entry("2026-07-01T06:00:00.000Z", { acceptedCount: 5 }));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]!.acceptedCount).toBe(5);
  });

  it("supports multiple runs on the same UTC day (distinct startedAt)", () => {
    let ledger: TokenLedger = { entries: [] };
    ledger = appendLedgerEntry(ledger, entry("2026-07-01T00:00:00.000Z"));
    ledger = appendLedgerEntry(ledger, entry("2026-07-01T06:00:00.000Z"));
    expect(ledger.entries).toHaveLength(2);
  });

  it("caps growth at maxEntries, dropping the oldest rows", () => {
    let ledger: TokenLedger = { entries: [] };
    for (let i = 0; i < 10; i += 1) {
      const day = String(i + 1).padStart(2, "0");
      ledger = appendLedgerEntry(ledger, entry(`2026-07-${day}T00:00:00.000Z`), 5);
    }
    expect(ledger.entries).toHaveLength(5);
    // Oldest kept is day 06 (days 01-05 dropped).
    expect(ledger.entries[0]!.startedAt).toBe("2026-07-06T00:00:00.000Z");
  });
});

describe("buildLedgerEntry", () => {
  it("projects only sanitized fields from a report + token summary", () => {
    const acc = new TokenAccumulator();
    acc.record("classification", "openai", "gpt-5.5", 1000);
    const summary = acc.summarize();
    const report = {
      runId: "2026-07-05",
      startedAt: "2026-07-05T00:00:00.000Z",
      completedAt: "2026-07-05T00:01:00.000Z",
      status: "success",
      counts: { accepted: 2 },
    } as unknown as RunReport;

    const built = buildLedgerEntry(
      report,
      { name: "@awesome-repo-graph/curator", version: "1.0.0", primaryModels: ["gpt-5.5"] },
      summary,
    );
    expect(built.acceptedCount).toBe(2);
    expect(built.totalTokens).toBe(1000);
    expect(built.byProvider[0]).toMatchObject({ provider: "openai", stage: "classification" });
    // byProvider rows in the ledger carry no model/raw fields beyond the sanitized set.
    expect(Object.keys(built.byProvider[0]!).sort()).toEqual(
      ["estimatedCostUsd", "provider", "stage", "totalTokens"].sort(),
    );
  });
});

describe("ledger persistence", () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "curator-ledger-"));
    ledgerPath = path.join(tmpDir, "token-ledger.json");
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips through disk", () => {
    writeLedger({ entries: [entry("2026-07-01T00:00:00.000Z")] }, ledgerPath);
    expect(loadLedger(ledgerPath).entries).toHaveLength(1);
  });

  it("returns an empty ledger for a missing or malformed file", () => {
    expect(loadLedger(path.join(tmpDir, "nope.json")).entries).toEqual([]);
    fs.writeFileSync(ledgerPath, "{ not json");
    expect(loadLedger(ledgerPath).entries).toEqual([]);
  });

  it("recordRunInLedger loads, appends, and persists", () => {
    const summary = new TokenAccumulator().summarize();
    const report = {
      runId: "2026-07-05",
      startedAt: "2026-07-05T00:00:00.000Z",
      completedAt: "2026-07-05T00:01:00.000Z",
      status: "success",
      counts: { accepted: 0 },
    } as unknown as RunReport;
    recordRunInLedger(
      report,
      { name: "@awesome-repo-graph/curator", version: "1.0.0", primaryModels: [] },
      summary,
      ledgerPath,
    );
    expect(loadLedger(ledgerPath).entries).toHaveLength(1);
  });
});
