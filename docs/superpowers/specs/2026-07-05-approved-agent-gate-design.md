# Approved-agent contribution gate — design

Status: implemented
Scope: enforce that catalog changes (`sources.json`, and the generated
`README.MD`) can only enter the repository when they were produced by an
**approved, verifiable agent** and independently pass the mechanical policy
gates. The gate is a required CI status check, not a human review step.

## Problem and threat model

`sources.json` is the single source of truth for the catalog; `README.MD`
and the `web/` graph are derived from it. The project accepts changes from an
autonomous curator and from sanctioned local runs. Without a gate, any
contributor can open a pull request that edits `sources.json` by hand and
inject low-quality, off-topic, or otherwise unprofessional links that never
passed the mechanical validation the curator enforces. Human review is
error-prone and does not scale; the trust boundary must be mechanical.

Abuse cases the gate must prevent:

1. **Raw hand-injection.** A PR edits `sources.json` directly (bypassing
   `scripts/add-source.js` and `curator/src/validation`) to add entries.
2. **Impersonation.** A PR claims to come from the curator but was not
   produced by it (forged author, copied commit trailer, etc.).
3. **Tamper-after-attest.** A valid change is produced by an approved agent,
   then edited before/after committing so the shipped bytes differ from what
   the agent actually vetted.
4. **Replay.** An old, genuinely-signed attestation is reused to bless a
   different (unvetted) change.
5. **Rogue self-approval.** A contributor signs with their own key and adds
   themselves to the approved list in the same PR.

Non-goals: this gate does not judge taste beyond the mechanical policy, does
not replace GitHub branch protection (it composes with it), and does not
attempt to stop a repository admin who can rewrite the registry and merge
without checks — that is an org-governance concern, addressed by making the
registry file itself a protected, review-required path (see "Approving a new
agent").

## Options considered

### Option A — Ed25519 detached-signature attestation over a content digest (chosen)

An approved agent, after producing a change, computes a SHA-256 digest of the
gated files (`sources.json` and `README.MD`), signs a canonical attestation
envelope binding `{agentId, keyId, producedAt, subject-digests}` with its
Ed25519 **private** key, and commits the resulting `agent-attestation.json`
alongside the change. CI recomputes the digests from the files actually in the
PR, looks the agent up in a committed **public** registry
(`agents/approved-agents.json`), and verifies the signature against the
agent's public key.

- Enforceable entirely in CI with Node's built-in `crypto` — no network, no
  external service, deterministic and unit-testable offline.
- Binds **who** (agent id + key in the allowlist) *and* **what** (digest of
  the exact bytes) in one artifact; defeats abuse cases 1–4 directly.
- No secret ever lives in the repo: only public keys are committed. The
  signing private key stays in a CI secret (referenced by name) or on the
  operator's machine.
- Works for both the CI curator (signs with a CI-secret key) and a sanctioned
  local run (signs with an operator-held key) — it is not tied to any single
  runtime identity.

### Option B — GitHub OIDC / Sigstore build provenance (rejected)

Use `actions/attest-build-provenance` so the change is provenance-signed by the
OIDC identity of the specific workflow, verified with `gh attestation verify`.

Rejected because it ties "approved producer" to *a GitHub Actions workflow
identity only*. A sanctioned local run cannot mint an OIDC provenance without
being inside Actions, which violates the "must not lock out a sanctioned local
run" constraint. It also depends on external Sigstore/transparency-log
infrastructure and network access, making the gate slower, flakier, and much
harder to unit-test offline.

### Option C — Trusted-committer / branch-protection identity check (rejected as primary)

Require that `sources.json` changes come only from an allowlisted committer
identity (e.g. the automation bot), enforced by checking commit author/committer.

Rejected because git author/committer fields are trivially forgeable — anyone
can set `user.email` to the bot's address locally. Making this trustworthy
requires GitHub-verified GPG signatures, which again binds identity to GitHub's
key management and is awkward for a generic "agent identity" and for local
runs. It also binds *who* but never *what* — it cannot detect tamper or replay.
Branch protection remains a valuable complementary org-level control, so the
docs recommend it, but it is not the content-trust mechanism.

## Chosen scheme (Option A) in detail

### Attestation format (`agent-attestation.json`, repo root, one per branch)

```json
{
  "schemaVersion": 1,
  "agentId": "awesome-repo-graph-curator",
  "producedAt": "2026-07-05T12:00:00.000Z",
  "subject": {
    "sources.json": "sha256:<hex>",
    "README.MD": "sha256:<hex>"
  },
  "mechanical": { "validated": true, "validator": "curator/src/validation" },
  "signature": {
    "algorithm": "ed25519",
    "keyId": "curator-2026",
    "value": "<base64 signature>"
  }
}
```

The signed message is the canonical JSON serialization (recursively
key-sorted, no insignificant whitespace) of the whole object **with
`signature.value` removed**. This binds the algorithm, key id, agent id,
timestamp, digests, and the mechanical-validation assertion into the
signature: none of them can be altered without invalidating it.

### Registry format (`agents/approved-agents.json`, committed, public)

```json
{
  "schemaVersion": 1,
  "agents": [
    {
      "id": "awesome-repo-graph-curator",
      "name": "Autonomous Source Curator",
      "status": "active",
      "keys": [
        {
          "keyId": "curator-2026",
          "algorithm": "ed25519",
          "status": "active",
          "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
          "addedAt": "2026-07-05"
        }
      ]
    }
  ]
}
```

Only **public** SPKI keys are committed. Multiple keys per agent enable
rotation: a compromised key is marked `"status": "revoked"` (never deleted, so
history stays auditable) and a new active key is added. An agent can be paused
by setting the agent-level `status` to anything other than `active`.

### CI enforcement (`.github/workflows/verify-agent.yml`)

A dedicated workflow runs on every pull request as a distinct required check,
`approved-agent-gate`. It runs on all PRs (not a `paths:` filter) so the
required check never gets stuck "pending" on PRs that don't touch the catalog;
the script itself decides:

1. Diff the PR head against its base. If neither `sources.json` nor
   `README.MD` changed, exit 0 (nothing to gate).
2. If they changed, run the **mechanical policy re-check** on the newly-added
   entries (structural schema, in-file dedup, tag/kebab format, min-stars and
   license policy read from `agents/gate-policy.json`, excluded owners/repos/
   keywords). This is the CI-side mechanical gate on the committed artifact.
3. Run **attestation verification**: load `agent-attestation.json`, confirm
   the agent and key are active in the registry, recompute the file digests
   and confirm they match the attestation subject, and verify the Ed25519
   signature.

All three must pass for the check to succeed. Branch protection marks
`approved-agent-gate` a required status check, so a failing or missing
attestation blocks merge regardless of reviewer action.

### Composition with the existing mechanical validation

The gate does not replace `curator/src/validation`; it composes with it in two
places:

- **Producer side (unchanged code path):** the curator already runs
  `mechanical.ts` + `dedupe.ts` before it ever calls `add-source.js`. When it
  then produces an attestation it records `mechanical.validated: true`.
- **CI side (independent re-check):** because a forged flag must never be
  trusted, the gate independently re-validates the committed diff against the
  subset of the same policy that is checkable from committed data (no network):
  schema, dedup, tag format, min-stars, license allow/deny, exclusion lists.
  Thresholds live in `agents/gate-policy.json`, documented as the CI mirror of
  `curator/src/config.ts`'s `quality` block, so the two cannot silently drift
  without a visible file change.

So the attestation proves *who/what*; the mechanical re-check proves the
change still satisfies policy; the required check passes only when both hold.

### Key and identity management

- Private signing keys are **never** committed. In CI the curator reads its key
  from the `CURATOR_SIGNING_KEY` secret (PEM contents, referenced by name
  only). A local operator points `scripts/attest.js` at a key file via
  `--key-file` or the `AGENT_SIGNING_KEY` env var.
- Public keys are committed in `agents/approved-agents.json` and are the only
  key material in the repository.
- `scripts/agent-keygen.js` generates a fresh Ed25519 keypair for onboarding.

### Failure modes

- **No attestation but catalog changed** → digest/lookup step fails → check
  fails.
- **Unknown agent id / revoked or missing key** → registry lookup fails →
  check fails.
- **Digest mismatch (tamper or replay)** → subject digests don't match the
  files → check fails.
- **Bad signature** → Ed25519 verify returns false → check fails.
- **Mechanical policy violation** (e.g. added entry below min-stars, denied
  license, duplicate) → policy re-check fails → check fails even with a valid
  signature.
- **Malformed registry/attestation JSON** → parsed defensively, treated as a
  hard failure rather than skipped.

### Approving a new agent

1. Run `node scripts/agent-keygen.js --agent-id <id> --key-id <id>-<year>`;
   keep the private key secret (CI secret or local key file), never commit it.
2. Open a PR that adds the agent's **public** key block to
   `agents/approved-agents.json`.
3. Because `agents/approved-agents.json` is a protected, review-required path
   (CODEOWNERS / branch protection), adding an agent is a deliberate,
   human-reviewed governance action — this closes the "rogue self-approval"
   abuse case: a contributor cannot both sign with their own key and approve
   that key in the same unreviewed change.

## Implementation plan

1. `scripts/lib/attestation.js` — pure, dependency-free core: canonical JSON,
   digesting, signing-payload construction, `signAttestation`,
   `verifyAttestation`, and `validateAddedEntries` (mechanical policy re-check).
2. `scripts/attest.js` — producer CLI: digests the gated files, signs, writes
   `agent-attestation.json`. Reads the private key by name/path only.
3. `scripts/verify-attestation.js` — verifier CLI: diffs against base, runs the
   policy re-check and the signature verification, exits non-zero on failure.
4. `scripts/agent-keygen.js` — Ed25519 keypair generator for onboarding.
5. `agents/approved-agents.json` (registry, public keys) and
   `agents/gate-policy.json` (CI policy mirror).
6. `.github/workflows/verify-agent.yml` — the required `approved-agent-gate`
   check.
7. `scripts/test/attestation.test.js` — `node:test` unit + end-to-end suite
   (keygen → attest → verify pass; unknown agent, tamper, missing attestation,
   policy violation all rejected).
8. Docs: `docs/agent-gateway.md`; `AGENTS.MD` gate reference; a
   "Contributing securely" section added via `scripts/generate-readme.js`
   (never by hand-editing `README.MD`).
