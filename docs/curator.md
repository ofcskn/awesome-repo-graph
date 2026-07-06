# Autonomous curator

`curator/` is a standalone TypeScript workspace that discovers, validates,
classifies, and adds new entries to `sources.json` on a schedule, using one
or more AI providers for classification. It never bypasses the repository's
existing rules in `AGENTS.MD`: every accepted source is still added through
`scripts/add-source.js`, and `README.MD` is still only ever produced by
`scripts/generate-readme.js`.

## Architecture

```
curator/
  src/
    config.ts            typed, non-secret operational config (single source of truth)
    env.ts                provider -> env-var mapping, credential validation
    types.ts              shared domain types (Candidate, Classification, ...)
    store-bridge.ts        CJS bridge to scripts/lib/store.js and scripts/lib/graph.js
    scheduling.ts           daily execution-window gate + last-run state
    maintenance.ts          web app build + a minimal static-export smoke check
    discovery/              GitHub, GitLab, Hugging Face, npm search -> normalized Candidate records
    validation/              mechanical.ts (policy gates), dedupe.ts (10 dedup layers)
    classification/          schema.ts (zod), taxonomy.ts, tags.ts, consensus.ts
    providers/                one adapter per AI provider + fallback/registry
    embeddings/                embedding provider adapters (openai/gemini/vertexGemini) + cosine-similarity search
    memory/                    rejection history + embedding vector store (curator/state/*.json)
    insertion/                  wraps scripts/add-source.js and refresh-scores.js
    git/                          branch/commit/PR helpers (git + gh CLI)
    reporting/                     audit report builder/writer
    run.ts                          orchestrates the whole pipeline
    cli.ts                           `run` / `validate-env` / `embeddings-sync` entry point
  state/
    rejected.json            rejection memory (committed, so it survives CI runners)
    last-run.json             last successful run timestamp (committed)
    embeddings.json            vector-embedding memory (committed) — see "Vector-embedding memory" below
    token-ledger.json           append-only per-run token/cost ledger (committed) — see "Run logging & token accounting" below
  reports/                    one JSON report per calendar day (see "Report format")
  test/                       vitest suite, all network/providers mocked
```

Pipeline order for each run: **discover → mechanically validate → dedupe →
classify (single provider or multi-provider consensus) → apply
taxonomy/tag budgets → insert via `add-source.js` → refresh scores → build
web app (optional) → smoke test (optional) → commit/PR → write report**.

## Local setup

```bash
cd curator
npm install
cp ../.env.example ../.env   # then fill in at least one provider key
```

## `.env` setup

Copy `.env.example` (repo root) to `.env` and fill in the providers you
want active. You only need the keys for the providers listed in
`curator/src/config.ts`'s `providers.enabled` array — not every provider.

| Provider | Env var |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Gemini Developer API | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Vertex Gemini (Express Mode) | `GEMINI_VERTEX_API_KEY` |
| Anthropic Claude | `ANTHROPIC_API_KEY` |
| Ollama / local OpenAI-compatible server | `OLLAMA_API_KEY` (optional) + `OLLAMA_BASE_URL` |

See "Local & self-hosted models" below for running the pipeline against a
local or self-hosted model.

Note: DeepSeek can classify candidates but cannot generate embeddings (no
embeddings endpoint) — see "Vector-embedding memory" below. Configure at
least one of OpenAI or Gemini/Vertex if you want embedding-based memory.

`.env` is git-ignored. Never commit it, and never put a real key inside
`config.ts` — `config.ts` is version-controlled and holds only non-secret
settings.

## GitHub secret setup

For the scheduled workflow (`.github/workflows/curate.yml`) to run, add the
variables for the providers in `providers.enabled` as **repository secrets**
(Settings → Secrets and variables → Actions): by default `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_VERTEX_API_KEY` (add
`ANTHROPIC_API_KEY` if you enable Anthropic). Only the ones you intend to use
need real values — an unset one simply disables that provider with a
sanitized warning in the run report, not a crash. The Ollama / local-server
provider is for local runs (see "Local & self-hosted models"), not the
scheduled CI workflow.

## Provider configuration

`config.ts`'s `providers` block controls which providers are active, which
is primary, fallback order, model names, per-provider weights (used by
multi-model consensus), request/timeout/retry limits, and the consensus
strategy. All providers share one structured-output contract
(`classification/schema.ts`) validated at runtime with zod — a provider
that returns malformed JSON is treated as a failure and the run falls back
to the next provider, never trusted as-is.

## `config.ts` reference

`config.ts` is grouped into: `automation`, `providers`, `discovery`,
`quality`, `taxonomy`, `scheduling`, `output`, `maintenance`. Every field
maps 1:1 to an item in the original spec (see the inline comments next to
each zod field in `curator/src/config.ts` for the exact item number). It is
validated with zod at load time (`loadConfig()`), so a malformed edit fails
fast with a clear error instead of silently misbehaving.

### Multi-platform discovery

`discovery.searchQueries`/`githubTopics` drive GitHub search, and
`discovery.platforms.{gitlab,huggingface,npm}` drive the three other
backends (each with its own `enabled` flag and `searchQueries` list).
`discovery/index.ts` interleaves jobs across every enabled platform
(round-robin, not platform-by-platform) so `dailyCandidateLimit` — now a
budget shared across all four platforms — never lets GitHub's larger result
set crowd out GitLab/Hugging Face/npm candidates. Star counts on non-GitHub
platforms are documented proxies, not literal GitHub stars (GitLab's
`star_count` is real; Hugging Face uses `likes`; npm uses a scaled
`score.detail.popularity`).

### Querying `sources.json` without loading it

Both the curator and any agent operating on this repo should reach for
`node scripts/filter-sources.js` (`--stats`, `--tag`, `--path`, `--provider`,
`--query`, `--id`) instead of reading `sources.json` in full — see AGENTS.MD's
"Inspecting sources without loading the whole file" section. The embedding
memory (below) already keeps AI classification prompts small; this does the
same for anyone inspecting the catalog by hand or via tooling.

## Dry-run usage

```bash
cd curator
npm run curate:dry-run
# or: npx tsx src/cli.ts run --dry-run
```

Dry-run runs discovery, validation, and classification for real, but never
calls `add-source.js`, never refreshes scores, and never touches git. The
report still gets written so you can inspect exactly what *would* have
happened.

## Manual-run usage

```bash
cd curator
npm run curate                 # full run, honors config.ts's commitMode
npx tsx src/cli.ts run --force # bypass the scheduling gate too (only matters with --scheduled)
npm run validate-env           # check which providers have usable credentials
npm run embeddings:sync        # manual full embedding backfill/repair (see "Vector-embedding memory")
```

A manual `run` (no `--scheduled`) always executes immediately — the daily
scheduling gate only applies to the `--scheduled` entry point used by the
GitHub Actions workflow.

## Local & self-hosted models

The pipeline can be triggered locally against a model you control — a local
model served by Ollama, any OpenAI-protocol local server, or hosted Anthropic
Claude — and will draft a new-sources pull request from the result.

```bash
cd curator
npm run curate:local                 # local run: Ollama primary, drafts a PR
npx tsx src/cli.ts run --provider anthropic   # force Anthropic Claude as primary
npx tsx src/cli.ts run --local --dry-run      # local run, but touch nothing (no git)
```

The local trigger (`--local`, or `--provider <name>`) forces the chosen
provider as the primary classifier and defaults `output.commitMode` to
`pull-request`, so a successful run produces a drafted `curator/auto/<date>`
branch and PR (via the same `git/` PR path the scheduled workflow uses).
`--dry-run` still skips all git activity, and a manual local run executes
immediately — the scheduling gate only applies to `--scheduled`. Other
enabled providers remain available as fallbacks if the primary fails on a
candidate.

### Ollama (local)

Ollama exposes an OpenAI-compatible endpoint at `http://localhost:11434/v1`.
Pull a model and start the server, then run the local trigger:

```bash
ollama pull hermes3          # or any tag you want to classify with
ollama serve                 # if not already running
cd curator && npm run curate:local
```

- The model tag is `config.providers.models.ollama` (default `hermes3`) —
  change it there to use a different local model.
- No API key is required. Ollama is a "keyless" provider: it reports as
  usable without a secret, and an unreachable server surfaces as a normal
  per-candidate provider failure (falling back to the next provider), not a
  hard startup error. Set `OLLAMA_API_KEY` only if your server enforces one.

### Other OpenAI-compatible local servers (Hermes, "OpenClaw", …)

Any server that speaks the OpenAI chat-completions protocol (llama.cpp,
vLLM, LM Studio, text-generation-webui, …) works through the same `ollama`
adapter by configuration alone — no new code:

1. Set `OLLAMA_BASE_URL` to that server's `/v1` endpoint (e.g.
   `http://localhost:8000/v1`).
2. Set `config.providers.models.ollama` to that server's model tag (the
   Hermes or "OpenClaw" name it serves).
3. Run `npm run curate:local` (or `--provider ollama`).

If a model is only reachable over a *non*-OpenAI protocol, it would need its
own adapter — see "Adding another AI provider" below. This project does not
ship one, and does not invent an API for a transport it can't verify.

### Anthropic Claude (hosted)

Set `ANTHROPIC_API_KEY` in `.env`, then force Anthropic as primary:

```bash
cd curator
npx tsx src/cli.ts run --provider anthropic
```

- The model is `config.providers.models.anthropic` (default
  `claude-opus-4-8`).
- `ANTHROPIC_BASE_URL` can point the adapter at a hosted gateway/proxy.
- The adapter reports token usage (`input + output`) so cost accounting can
  consume it.

## Scheduler behavior

GitHub Actions cron can't read `config.ts` at trigger time, so
`.github/workflows/curate.yml` fires **hourly** and lets
`curator/src/scheduling.ts` decide whether to actually do anything:

1. Compute the current hour in `config.scheduling.timezone`.
2. Skip unless it's one of `config.scheduling.executionHours` — this is an
   array, so **multiple runs per day are supported out of the box**. The
   shipped default is `[0, 6, 12, 18]` (UTC), i.e. 4 runs/day, 6 hours
   apart. To change the cadence or times, just edit that array — no
   workflow YAML change needed, since the cron already fires every hour
   and the array is what decides which hours actually do work.
3. Skip if fewer than `config.scheduling.minIntervalHoursBetweenRuns` hours
   have passed since `curator/state/last-run.json`'s `lastSuccessAt` (this
   only guards against a cron tick double-firing near the same hour; keep
   it comfortably below the spacing between your `executionHours`).
4. `workflow_dispatch` accepts a `force` input that bypasses both checks
   (for manual/on-demand runs) and a `dry_run` input.

`concurrency: { group: curator, cancel-in-progress: false }` prevents two
runs from ever executing at once — a new trigger queues behind an
in-flight run instead of racing it.

**Cost note**: `discovery.dailyCandidateLimit` and `quality.maxAcceptedPerRun`
are *per-run* caps, not per-day. The shipped defaults (10 candidates / 2
accepted per run) are deliberately sized so that 4 runs/day totals the same
daily volume (40 discovered / 8 accepted) as the original single-run/day
design — increasing `executionHours`' length without lowering these
proportionally will directly multiply AI provider spend.

## Rejected-candidate and reconsideration memory

`curator/state/rejected.json` remembers every mechanically- or AI-rejected
candidate so it is **not re-fetched/re-classified on the next run** unless
one of these is true: its metadata (stars/license/activity/fork/archive
state) changed, its reconsideration date has arrived, or the config
fingerprint changed. This check happens *before* any GitHub API call or AI
classification for that candidate — see `checkReconsideration()` in
`curator/src/memory/rejection-store.ts`, called first thing in `run.ts`'s
per-candidate loop.

Two windows control how long this memory holds, both in `config.memory`:

- `recentEvaluationWindowDays` (default 7) — how long a mechanically- or
  duplicate-rejected candidate is skipped with no further checking.
- `aiRejectionReconsiderationDays` (default 14) — how long an AI-rejected
  candidate is skipped before automatic reconsideration.

These used to be hardcoded literals in `run.ts`; they're now config so you
can tune the memory/cost tradeoff without touching code. Raising them
reduces AI spend further (fewer re-examinations); lowering them makes the
catalog more responsive to a repository's metadata improving.

We deliberately did **not** build a separate "already-approved-but-not-yet-inserted"
cache: `run.ts`'s loop stops calling any AI provider the moment
`quality.maxAcceptedPerRun` is reached for a given run, so no candidate is
ever classified-and-approved-but-then-discarded within a single run — there
was nothing to cache. The one remaining edge case (a `commit`-mode push or
PR step failing *after* `add-source.js` already ran locally) is called out
under "Known limitations" below rather than solved with extra persistence,
since it's rare and the fix (retry the push) doesn't need AI memory.

## Vector-embedding memory (token-cost reduction)

Without embeddings, every classification call would need the taxonomy list,
tag list, and some notion of "related existing sources" in its prompt. The
first two are bounded by category/tag cardinality (small, fine to send in
full); the third is not — a naive approach re-sends information that scales
with catalog size, and catalog size only grows. `curator/state/embeddings.json`
fixes the scaling part: it stores a vector embedding per catalogued source,
and at classification time the curator retrieves only the `embeddings.topK`
(default 8) most semantically similar existing sources via cosine similarity
— a small, constant-size context per call, regardless of whether
`sources.json` has 40 entries or 4,000.

**Providers**: OpenAI (`text-embedding-3-small`) and Gemini/Vertex
(`gemini-embedding-001`) — confirmed live against DeepSeek's own API
reference (July 2026): DeepSeek has no embeddings endpoint, only chat/
completions/models, so it's excluded from `config.embeddings.provider`'s
schema entirely (enforced at the zod level, not just by convention).
`resolveEmbeddingProvider()` prefers `config.embeddings.provider` but falls
back to any other embedding-capable provider with credentials; if none is
configured, the pipeline falls back to the pre-existing topic-overlap
heuristic (`selectRelatedSourcesByTopic()` in `providers/prompt.ts`) —
embeddings are an optimization, never a hard requirement to run.

**"Update embedded memory when sources.json changes"**: `run.ts` calls
`syncEmbeddings()` once at the start of every run, which embeds only
sources that are new or whose title/description/taxonomy/tags changed since
last sync (compared via a text hash) and prunes entries for sources no
longer present — an unchanged catalog costs zero embedding calls on repeat
runs. Right after a new source is inserted, it's embedded immediately
(`embedAndStoreOne()`) so later candidates *in the same run* can already
find it as a neighbor, without waiting for the next run's sync pass.

**Manual backfill/repair**: `npm run embeddings:sync` (or
`npx tsx src/cli.ts embeddings-sync`) re-syncs the whole catalog on demand —
useful after changing `config.embeddings.provider`/model/`dimensions`
(which invalidates every cached vector, since the store tracks model+
dimensions per record) or if `curator/state/embeddings.json` was deleted.

**Also closes a real gap**: the same embeddings now power genuine semantic
near-duplicate detection in `validation/dedupe.ts` (candidate vs. every
existing source's embedding, flagged above
`config.embeddings.duplicateSimilarityThreshold`, default 0.93) — previously
this was only a word-overlap title heuristic, which a same-project source
described in different words would slip past.

**Size control**: `config.embeddings.dimensions` (default 256, both
providers support server-side truncation via this exact param) keeps
`curator/state/embeddings.json` compact — full 1536/3072-dim vectors would
make the file grow considerably faster than `sources.json` itself as the
catalog scales.

## Deploying after a run (GitHub Pages)

`deploy-pages.yml` already deploys automatically on every `push` to the
default branch — so in the default `pull-request` output mode, deployment
happens for free the moment a human merges the automation PR, no extra
wiring needed.

If you set `config.output.commitMode: "commit"` instead (direct push, no
PR), there's a GitHub Actions quirk to work around: **pushes made with a
workflow's own `GITHUB_TOKEN` do not trigger other workflows' `on: push`**
(this is GitHub's built-in loop-prevention). Without it, a direct commit
would silently never redeploy the site. So `run.ts` explicitly dispatches
`deploy-pages.yml` via `gh workflow run deploy-pages.yml --ref <branch>`
(`dispatchWorkflow()` in `curator/src/git/branch.ts`) — but **only** right
after confirming a real commit was pushed to that branch. It is never
called in `pull-request` or `report-only` mode, and never called
unconditionally, so it can't trigger a rebuild of unchanged content.

**This cannot become a workflow loop**: the dispatch is a one-shot
`workflow_dispatch` API call, not a push — `deploy-pages.yml` has no step
that pushes commits or calls `curate.yml`, so there is no path back. The
workflow needs `actions: write` permission to make this call (already
granted in `curate.yml`).

## Security: what actually gets deployed

Only `web/out/` — the Next.js static export — is ever uploaded to GitHub
Pages (`actions/upload-pages-artifact@v3`'s `path: web/out` in
`deploy-pages.yml`, unchanged by this feature). The web app only reads root
`sources.json` at build time. `curator/state/*.json` (rejection memory,
last-run timestamp) and `curator/reports/*.json` (audit reports) live
entirely outside `web/` and are never imported, referenced, or copied into
it — they are structurally impossible to end up in a Pages deployment, no
matter what changes inside `curator/`.

## Pull-request / commit behavior

Controlled by `config.output.commitMode`:

- `"report-only"` — never touches git, only writes the report.
- `"commit"` — commits directly to the current branch and pushes (never
  force-pushes; a rejected non-fast-forward push is reported, not retried
  destructively).
- `"pull-request"` (default) — creates `curator/auto/<YYYY-MM-DD>` off the
  current branch, commits, pushes, and opens a PR. If a same-day
  automation PR is already open for that branch, it's updated in place
  (`gh pr edit`) instead of opening a duplicate.

No commit or PR is ever created when there were zero accepted sources —
idempotent re-runs on an unchanged candidate set produce no git activity.

## Failure recovery

- **No provider has credentials**: the run fails immediately, before
  discovery starts (fail-closed, per spec) — check `validate-env` output.
- **A provider returns malformed JSON / times out / rate-limits**: handled
  per-candidate via retry + exponential backoff, then fallback to the next
  provider; recorded in the report's `providerFailures` / `retryCounts`,
  never crashes the whole run.
- **`add-source.js` fails for one candidate**: only that candidate is
  marked `insertion-failed`; the rest of the run continues.
- **Push/PR step fails**: reported in `notes`; the report and any local
  commit are unaffected (the commit isn't rolled back, but nothing is lost
  since it's on a dedicated branch).

## Report format

One JSON file per UTC calendar day at `curator/reports/run-<YYYY-MM-DD>.json`
(re-run the same day and it overwrites, keeping the report count bounded
and diffs meaningful). Arrays/objects with no inherent order are sorted
before writing so reports diff cleanly. See `curator/src/reporting/report.ts`
for the full `RunReport` shape — it covers every field in the spec's AUDIT
REPORTS section (run id, timestamps, config fingerprint, provider
status, counts at every pipeline stage, accepted URLs, taxonomy/tag
changes, rejection reason counts, duplicate matches, provider
disagreements/failures/retries, files changed, commands executed,
score-refresh/validation/build results, and the commit/PR outcome). It
never includes API keys or raw provider payloads. It also carries the
`agent` and `tokenUsage` blocks described in "Run logging & token
accounting" below.

## Run logging & token accounting

Every run records **when the agent worked, which agent/model did it, and how
many tokens (and roughly how much money) it cost** — logged securely, never
exposing secrets, PII, or raw prompts/completions.

### Where it comes from

Each provider classification call already returns an approximate token count
(`ClassifyOutcome.totalTokens`, populated by the OpenAI-/Gemini-compatible
adapters from the SDK's reported usage). The pipeline threads those per-call
counts up through `consensus.ts` and aggregates them in `run.ts` via a
`TokenAccumulator` (`curator/src/reporting/token-accounting.ts`) into
per-run totals, broken down by **provider** and **pipeline stage**
(`classification` and `embeddings`).

### In the report

Each `curator/reports/run-<date>.json` gains two blocks:

- `agent` — the curator's own package `name` and `version` (read from
  `curator/package.json`; never author or git identity) plus
  `primaryModels`, the distinct models actually used that run.
- `tokenUsage` — grand-total tokens and estimated USD cost, a `byStage`
  breakdown, and a `byProvider` array (each row: provider, stage, model,
  call count, `callsWithoutUsage`, `totalTokens`, `estimatedCostUsd`).
  `estimateBasis` marks the cost as an estimate.

### The ledger

`curator/state/token-ledger.json` is a committed, **append-only** log with
one sanitized row per run: run id, ISO timestamps, status, agent
name/version, primary model(s), accepted-source count, per-provider token
totals, and estimated cost. It is the "log of when the agent worked and what
it cost" artifact, and it survives ephemeral CI runners because it is
committed.

- **Ordering / idempotency**: rows are keyed by exact `startedAt` and sorted
  ascending, so re-running replaces a row instead of duplicating it and
  diffs are clean append-at-the-end changes. Multiple runs per UTC day are
  supported (distinct timestamps).
- **Bounded growth**: capped to the most recent `MAX_LEDGER_ENTRIES` (500)
  rows — about 125 days at the default 4-runs/day cadence — with the oldest
  rows dropped on write.
- **Commit timing**: written every non-dry run and staged alongside any
  accepted-source commit. This preserves the "no git activity on zero
  accepts" invariant, so a zero-accept CI run's ledger row is ephemeral
  unless a later commit in the same checkout includes it.

### Estimated cost

`curator/src/pricing.ts` holds a small, editable price table keyed by model
name (a blended USD rate per 1,000,000 tokens, since providers report a
single `total_tokens` figure). Cost is `tokens × rate` and is always an
**estimate**. A provider that reports no usage yields `totalTokens: null`
and `estimatedCostUsd: null` — never `0` — and an unpriced model yields a
`null` cost rather than a fabricated one. The embeddings stage appears with
its provider/model but `null` tokens today, because the embedding adapters
do not surface SDK usage; the schema already supports real embedding totals
if that changes.

### Security guarantees

The report and ledger carry only integers (token counts), floats (cost),
public model-name strings, enums, and the package name/version — never API
keys, raw request/response bodies, prompts, completions, or owner identity.
Nothing in this subsystem reads provider secrets. `token-logging-security.test.ts`
enforces this: it serializes a populated report and ledger while fake
`sk-…`-shaped keys sit in the environment and asserts the output contains no
secret-shaped strings, no auth field names, and none of the planted values.

## Cost-control guidance

- `discovery.dailyCandidateLimit` and `quality.maxAcceptedPerRun` bound how
  much work (and how many provider calls) a single run can do.
- `providers.consensusStrategy: "primary-with-fallback"` (the default) only
  calls one provider per candidate unless it fails — the cheapest mode.
  Multi-provider strategies (`weighted-consensus`, etc.) call every enabled
  provider per candidate, multiplying cost by provider count; use them
  deliberately, not as the default.
- `providers.requestLimitPerRun` and `providers.maxConcurrentRequests` cap
  worst-case spend and avoid bursting past provider rate limits.
- Rejected candidates are remembered (`curator/state/rejected.json`) so the
  same repository isn't re-classified (and re-billed) every day unless its
  metadata materially changes or its reconsideration date arrives.
- Vector-embedding memory (`curator/state/embeddings.json`) keeps
  classification prompts small and roughly constant-size as the catalog
  grows, instead of the "related sources" context scaling with
  `sources.json`'s size — see "Vector-embedding memory" above. Embedding
  calls themselves are 1-2 orders of magnitude cheaper than a classification
  call, so enabling them is a strict cost win whenever a supported provider
  (OpenAI or Gemini/Vertex) is configured.

## Adding another AI provider

1. Add the provider's env var to `PROVIDER_ENV_VARS` in `curator/src/env.ts`
   and to `.env.example`.
2. Add it to the `ProviderName` union (`env.ts`) and to
   `configSchema`'s `providerNameSchema` enum in `config.ts`, plus a
   default model/weight/limit/timeout entry in `defaultConfig`.
3. Implement `curator/src/providers/<name>.ts` returning an `AIProvider`
   (see `providers/types.ts`) — reuse `openai-compatible-base.ts` if the
   provider speaks the OpenAI chat-completions protocol, or
   `gemini-compatible-base.ts` if it's a Gemini-family API; otherwise
   implement `classify()` directly, always validating the response with
   `classification/schema.ts` before trusting it.
4. Register the factory in `providers/index.ts`'s `FACTORIES` map.
5. Add it to `config.ts`'s `providers.enabled` (and `fallbackOrder` if
   relevant).

## Known limitations

- **Multi-model review strategies**: the spec lists six named strategies;
  this implementation collapses them into two code paths —
  `primary-with-fallback` (single-chain) and a general weighted-consensus
  path used for every other strategy name. Disagreement/high-risk review is
  realized as "surface disagreements and defer" rather than as separate
  bespoke pipelines; `taxonomy-only-secondary` currently falls back to the
  weighted-consensus path rather than running a distinct taxonomy-only
  secondary call.
- **Semantic near-duplicate detection**: implemented via embeddings (see
  "Vector-embedding memory") when a supported provider is configured;
  otherwise falls back to the word-overlap (Jaccard) title-similarity
  heuristic, which a same-project source described in very different words
  could still slip past.
- **Redirect/mirror detection** (spec item 4, "redirects to an unrelated
  project") is not independently verified beyond a plain HTTP reachability
  check; deep content-diffing across redirects is not implemented.
- **Browser smoke tests**: this repository has no existing e2e/browser test
  framework, so `runSmokeTests()` is a minimal static-file check (confirms
  `web/out/index.html` exists and contains the newly-added URLs), not a
  full Playwright walkthrough of the graph/tag filters/detail panel.
- **Commit/push failure after insertion**: `insertSource()` runs
  `add-source.js` (which mutates the local, ephemeral runner's
  `sources.json`) *before* the later git commit/push step. If that later
  push or PR step then fails, the accepted change never reaches the remote
  repo and is lost when the runner is discarded. The next run will simply
  rediscover and reclassify the same candidate rather than silently losing
  it forever — a small repeated cost, not silent data loss — but there is
  no explicit retry/resume for a failed push itself.
