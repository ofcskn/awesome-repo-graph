# Local & self-hosted model curation trigger

Design for letting a developer run the curation pipeline locally against
local or self-hosted models to propose new sources and draft a pull request.

## Goal

Give a developer a one-command way to run the existing discover → validate →
dedupe → classify → insert → PR pipeline against a model they control —
either a fully local model served by Ollama, an OpenAI-protocol local server
(Hermes, "OpenClaw", or any tag served that way), or hosted Anthropic Claude —
and have the run draft a new-sources PR branch instead of committing to the
default branch.

Everything is additive. The four existing providers (openai, gemini,
vertexGemini, deepseek) keep working unchanged.

## What the model names map to

| Requested capability | Provider adapter | How model/endpoint is chosen |
|---|---|---|
| Ollama (local) | `ollama` | `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`) + `config.providers.models.ollama` (default `hermes3`) |
| Hermes (e.g. `hermes3`) served by Ollama | `ollama` | Set `config.providers.models.ollama` (or override) to the Ollama model tag |
| Hermes / "OpenClaw" served by any OpenAI-protocol local server (llama.cpp, vLLM, LM Studio, text-generation-webui, …) | `ollama` | Point `OLLAMA_BASE_URL` at that server's `/v1` endpoint and set the model name to that server's tag |
| Hosted Anthropic Claude | `anthropic` | `ANTHROPIC_API_KEY` + `config.providers.models.anthropic` (default `claude-opus-4-8`) |

"Hermes" is a concrete open model tag (`hermes3` and friends) — it needs no
new code; it is a model **name** you pass to the Ollama adapter (or to any
OpenAI-compatible server the adapter points at). "OpenClaw" is treated the
same way: any local model reachable over the **OpenAI chat-completions
protocol** works purely by configuration (base URL + model name) through the
`ollama` adapter — it is deliberately a generic "OpenAI-compatible local
server" adapter, not an Ollama-only one. If a future "OpenClaw" server were
only reachable over a *non*-OpenAI protocol, it would need its own adapter;
that case is documented as out of scope rather than guessed at (we do not
invent an API for it).

## Providers

### Ollama / OpenAI-compatible local (`providers/ollama.ts`)

Reuses `openai-compatible-base.ts` — Ollama exposes an OpenAI
chat-completions endpoint at `http://localhost:11434/v1`, so the existing
DeepSeek pattern (OpenAI base + different `baseURL`) applies directly. Two
small capabilities are added to the base:

- `resolveBaseURL()` — the base URL is read at call time from
  `OLLAMA_BASE_URL` (falling back to the localhost default), so it is fully
  env-driven and can point at any OpenAI-protocol server.
- `apiKeyOptional` / `placeholderApiKey` — local servers usually need no key.
  The OpenAI SDK still requires *some* key string, so a placeholder
  (`"ollama"`) is sent when `OLLAMA_API_KEY` is unset. This also makes the
  provider report as "configured" without a secret (a keyless provider), so
  it is never disabled just because no key is present.

`json_object` response format is used (not strict `json_schema`) because
local servers vary in schema support; the JSON is validated with the same
zod schema as every other provider, so a malformed response is a normal
provider failure that falls back to the next provider.

### Anthropic Claude (`providers/anthropic.ts`)

A new adapter implementing `AIProvider` directly against Anthropic's
Messages API (`POST /v1/messages`). Uses `fetch` (no new dependency, so
`npm ci` stays reproducible and the HTTP call is trivially mockable in
tests). Reads `ANTHROPIC_API_KEY`; base URL overridable via
`ANTHROPIC_BASE_URL`. The shared classification prompt's system text becomes
the top-level `system` field and the user text becomes the single user
message. The text block is parsed as JSON (with a lenient brace-extraction
fallback for models that wrap output in prose/fences) and validated with the
same zod schema. `totalTokens` is populated from `usage.input_tokens +
usage.output_tokens` so the parallel token-logging work can consume it.

Model defaults to `claude-opus-4-8`; no `temperature`/`thinking` params are
sent (current Claude models reject non-default sampling params), matching
Anthropic's guidance for structured extraction.

## Config / env additions

- `env.ts`: `ProviderName` union gains `ollama` and `anthropic`;
  `PROVIDER_ENV_VARS` maps `ollama → OLLAMA_API_KEY`,
  `anthropic → ANTHROPIC_API_KEY`. `KEYLESS_PROVIDERS` (contains `ollama`)
  makes keyless providers report as credential-present. `getOllamaBaseURL()`
  resolves `OLLAMA_BASE_URL` with the localhost default.
- `config.ts`: `providerNameSchema` enum gains the two names; `defaultConfig`
  gains model / weight / requestLimit / timeout entries for both (they are
  **not** added to `providers.enabled` by default, so existing runs are
  unchanged). Two new `LoadConfigOverrides` fields — `primaryProvider` and
  `commitMode` — let the local trigger force a primary provider (adding it to
  `enabled` if needed) and default the output mode, without any `run.ts`
  change (the pipeline already loads config through `loadConfig(options)`).
- `.env.example`: adds `ANTHROPIC_API_KEY`, `OLLAMA_BASE_URL`, and optional
  `OLLAMA_API_KEY`.

## Local trigger UX

- `npm run curate:local` → `tsx src/cli.ts run --local`.
- CLI flags on the `run` command:
  - `--local` — local run; defaults the primary provider to `ollama` and the
    commit mode to `pull-request`.
  - `--provider <name>` — force any provider as primary for this run (e.g.
    `--provider anthropic`, `--provider ollama`). Implies the same
    pull-request default. Validated against the known provider names.
- Existing `--dry-run` and `--force` semantics are unchanged. A manual local
  run executes immediately: the scheduling gate only applies to the
  `--scheduled` entry point, which `--local` never sets.

Because `commitMode` defaults to `pull-request`, the result of a successful
local run is a drafted `curator/auto/<date>` branch + PR (reusing the
existing `git/` PR-drafting path) — unless `--dry-run` is passed, in which
case nothing touches git and the report still shows what would have happened.

## Tradeoffs

- **Ollama adapter is intentionally generic.** One adapter covers Ollama and
  every OpenAI-protocol local server; the cost is that a genuinely
  non-OpenAI "OpenClaw" transport would need a separate adapter (documented,
  not invented).
- **Anthropic via `fetch`, not the SDK.** Avoids a lockfile change (keeps
  `npm ci` green) and keeps tests network-free. The cost is manually shaping
  the request/response, which is small and well-covered by the Messages API
  contract.
- **Overrides in `loadConfig` rather than `run.ts`.** Keeps `run.ts`
  untouched (fewer merge conflicts with parallel token-logging work) at the
  cost of two extra fields on `LoadConfigOverrides`.
- **Keyless provider handling.** Treating Ollama as always-credential-present
  is what lets a no-key local run proceed; a server that is down surfaces as
  a normal per-candidate provider failure/fallback, consistent with existing
  behavior.

## Implementation plan

1. `env.ts` — add provider names, env-var mapping, `KEYLESS_PROVIDERS`,
   `getOllamaBaseURL()`, keyless-aware credential status.
2. `config.ts` — extend the provider enum + `defaultConfig` maps; add
   `primaryProvider` / `commitMode` overrides applied in `loadConfig`.
3. `providers/openai-compatible-base.ts` — add `resolveBaseURL`,
   `apiKeyOptional`, `placeholderApiKey`.
4. `providers/ollama.ts` — new adapter.
5. `providers/anthropic.ts` — new fetch-based adapter.
6. `providers/index.ts` — register both factories.
7. `cli.ts` — parse `--local` / `--provider`, thread overrides to
   `runPipeline`.
8. `package.json` — add `curate:local` script.
9. `.env.example` — add the new keys.
10. Tests (all network mocked): Ollama parses a mocked OpenAI-shaped response
    and validates the schema; Anthropic parses a mocked Messages response,
    extracts JSON, validates, and reports tokens; config/env accept the new
    providers and apply the overrides.
11. `docs/curator.md` — "Local & self-hosted models" section; bump the
    provider count references in the doc.
