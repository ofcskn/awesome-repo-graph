# Run logging & token accounting — design

Status: implemented
Scope: `curator/` (reporting, `run.ts`, config-adjacent pricing module, committed state, tests) and its docs.

## Problem

Every curation run calls one or more AI providers to classify (and,
optionally, embed) candidate repositories. Each provider call already
returns an approximate token count (`ClassifyOutcome.totalTokens`, populated
by the OpenAI-/Gemini-compatible bases from the SDK's reported usage), but
nothing aggregates or persists it. As a result a run is not auditable for:

- **when** the agent worked (already partly covered by report timestamps),
- **which** agent + model(s) did the work,
- **how many tokens** it consumed, and
- **roughly how much money** that cost.

This subsystem makes each run auditable on all four axes, logged securely:
never secrets, never PII, never raw prompts/completions.

## What is captured

Per run, aggregated from the per-call token counts that already flow out of
the provider layer:

1. **Per-provider, per-stage token totals.** Pipeline stages are
   `classification` and `embeddings`. Classification totals are the sum of
   `totalTokens` across every classification call for that provider in the
   run. See "Embeddings usage" below for why the embeddings stage records
   `null` tokens today.
2. **Per-run grand total** tokens (sum of all reported usage), and a
   per-stage sub-total.
3. **Estimated USD cost**, derived from a config-driven price table
   (`curator/src/pricing.ts`). Explicitly labelled an estimate.
4. **Sanitized agent metadata**: the curator's own package `name` and
   `version` (read from `curator/package.json`), plus the distinct set of
   models actually used during the run.

### Null vs zero (important invariant)

A provider that does **not** report usage yields `totalTokens: null` and
`estimatedCostUsd: null` — never `0`. Zero would falsely imply "ran for
free"; `null` correctly means "unknown / not reported". Aggregation
preserves this: a bucket whose contributing calls all reported `null` stays
`null`; a bucket with a mix sums only the numeric values (best effort) and
records how many calls lacked usage. The grand total is `null` only when
*no* call anywhere in the run reported usage.

### Embeddings usage

The classification provider adapters surface `totalTokens`; the embedding
provider interface (`EmbeddingProvider.embed`) returns only vectors and does
not surface SDK usage. Per the subsystem's mandate to aggregate existing
signal rather than add new provider-layer plumbing, the `embeddings` stage
is a first-class part of the schema and records the provider + model used,
but its `totalTokens`/`estimatedCostUsd` are `null` (not reported) today.
The schema and aggregator already support real embedding token totals, so
surfacing usage from the embedding adapters later is a drop-in change with
no schema migration.

## Pricing model

`curator/src/pricing.ts` holds a small, editable price table keyed by model
name. Providers report a single `total_tokens` figure (not an input/output
split), so the honest granularity is a **blended USD rate per 1,000,000
tokens** per model:

```
cost_usd = (total_tokens / 1_000_000) * usdPer1MTokens(model)
```

Rules:

- Unknown model → cost `null` (never guess).
- `null` tokens → cost `null`.
- All figures are **estimates**; the summary carries `estimateBasis:
  "config-price-table"` and the docs label them as such. Rates are operator-
  editable in one place.

The table is a dedicated module rather than living in `config.ts` so the
config's zod schema and fingerprint stay unchanged (a price edit must not
churn the config fingerprint that scopes rejection memory).

## Report schema additions (`RunReport`)

```ts
agent: {
  name: string;            // curator package name (no author/PII)
  version: string;         // curator package version
  primaryModels: string[]; // distinct models used this run, sorted
};
tokenUsage: {
  estimateBasis: "config-price-table";
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  byStage: Record<"classification" | "embeddings", {
    totalTokens: number | null;
    estimatedCostUsd: number | null;
  }>;
  byProvider: Array<{
    provider: ProviderName;
    stage: "classification" | "embeddings";
    model: string | null;
    calls: number;
    callsWithoutUsage: number;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
  }>; // sorted by (stage, provider) for clean diffs
};
```

## Ledger schema (`curator/state/token-ledger.json`)

Append-only, committed state (survives ephemeral CI runners), one entry per
run:

```ts
{
  entries: Array<{
    runId: string;          // per-UTC-day id (matches the report)
    startedAt: string;      // ISO — the unique key within the ledger
    completedAt: string;
    status: "success" | "partial" | "failed" | "skipped";
    agentName: string;
    agentVersion: string;
    primaryModels: string[];
    acceptedCount: number;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    byProvider: Array<{
      provider: ProviderName;
      stage: "classification" | "embeddings";
      totalTokens: number | null;
      estimatedCostUsd: number | null;
    }>;
  }>;
}
```

- **Uniqueness / idempotency**: keyed by exact `startedAt`. Re-appending an
  entry with the same `startedAt` replaces it, so a retried run does not
  duplicate a row.
- **Ordering**: entries sorted ascending by `startedAt` (then `runId`) so
  diffs are append-at-the-end and clean.
- **Bounded growth (rotation)**: capped to the most recent
  `MAX_LEDGER_ENTRIES` (500) rows; older rows are dropped on write. At 4
  runs/day that is ~125 days of history — enough for cost trending without
  unbounded file growth. The cap is a single constant.
- **Commit timing**: like the per-day report, the ledger is written every
  non-dry run and added to the run's `filesChanged`, so it is committed
  together with the next accepted-source commit. This preserves the existing
  "no git activity when zero sources are accepted" invariant; a zero-accept
  CI run's ledger entry is therefore ephemeral unless a later commit in the
  same checkout includes it (documented limitation, unchanged git posture).

## Security guarantees

The report and ledger must never leak secrets, PII, or raw provider I/O.
Guarantees and how they hold:

1. **No API keys.** Nothing in this subsystem reads `process.env` provider
   keys or `getProviderSecret()`. Only integers (token counts), floats
   (cost), model-name strings, the package name/version, and enums flow into
   the summary/ledger.
2. **No raw provider payloads.** Only `totalTokens` (a number the SDK
   reports) crosses the boundary — never request or response bodies,
   prompts, or completions. This preserves the pre-existing report invariant.
3. **No owner/PII.** Agent identity is the package `name`/`version` only;
   the reader never touches `author`, git identity, or any personal field.
4. **Enforced by test.** `token-logging-security.test.ts` builds a report
   and ledger with realistic data while a fake `sk-…`-shaped key is present
   in `process.env`, serializes both to JSON, and asserts the output
   contains no secret-shaped strings (`sk-…`, `key-…`, `Bearer …`), no
   `apiKey`/`authorization` field names, and not the planted env value.

## Implementation plan

1. `curator/src/pricing.ts` — price table + `estimateCostUsd(model,
   tokens)`. Tests: `pricing.test.ts` (known/unknown model, null tokens).
2. `curator/src/reporting/token-accounting.ts` — `TokenAccumulator`
   (`record(stage, provider, model, tokens)` → `summarize(pricing)`), plus
   the summary types. Tests: `token-accounting.test.ts` (per-provider /
   per-stage / grand-total math; null vs zero; mixed null+numeric).
3. `curator/src/reporting/agent.ts` — `readAgentMetadata()` reads
   `curator/package.json` for `{ name, version }` only.
4. `curator/src/reporting/ledger.ts` — load / append (idempotent, sorted,
   capped) / write. Tests: `ledger.test.ts` (idempotency, ordering, cap).
5. `types.ts` — add `totalTokens: number | null` to `ProviderClassification`;
   `consensus.ts` — populate it from the provider outcomes.
6. `report.ts` — extend `RunReport` with `agent` + `tokenUsage`; sort
   `byProvider` in `finalizeReportForWrite`.
7. `run.ts` — minimal, additive wiring: accumulate classification tokens
   from `consensus.perProvider`, register the embeddings stage, attach the
   summary + agent metadata to the report, and write the ledger.
8. `token-logging-security.test.ts` — the no-secrets assertion above.
9. Docs: a "Run logging & token accounting" section in `docs/curator.md`.
