# Approved-agent gateway

The catalog (`sources.json`, and the `README.MD` generated from it) accepts
changes only from an **approved, verifiable agent**. This document explains the
trust model, the attestation format, the CI check, and how to become an
approved agent. It is the trust backbone that the autonomous curator and any
sanctioned local run submit through.

## Why

`sources.json` is the single source of truth for the catalog. Any pull request
could otherwise hand-edit it to inject low-quality or off-topic links that
never passed the mechanical validation the curator enforces. Human review does
not scale and is not a reliable trust boundary. The gateway makes acceptance
mechanical: a change to the catalog can only merge if it carries proof that an
approved agent produced it *and* the change still passes the mechanical policy.

## Trust model

- Each approved agent owns an **Ed25519 keypair**. The **public** key is
  published in `agents/approved-agents.json` (committed). The **private** key is
  held only as a CI secret or on an operator's machine and is **never**
  committed.
- After producing a change, the agent signs an attestation binding its identity
  (`agentId` + `keyId`, both in the registry) to SHA-256 digests of the gated
  files, and commits it as `agent-attestation.json`.
- CI recomputes the digests from the files actually in the pull request, looks
  the agent up in the registry, and verifies the signature. Content tampering,
  agent impersonation, and replay of an old attestation all fail verification.

This binds both **who** produced the change and **what** exactly was produced.
It does not rely on git author/committer fields (which are forgeable) or on any
external service.

## What the gate checks

The `approved-agent-gate` check (`.github/workflows/verify-agent.yml`,
implemented by `scripts/verify-attestation.js`) runs on every pull request and:

1. **Detects catalog changes.** If neither `sources.json` nor `README.MD`
   changed versus the PR base, the gate is not required and passes immediately.
   (The workflow runs on all PRs, so the required check never gets stuck
   "pending".)
2. **Re-runs mechanical validation.** The newly-added `sources.json` entries are
   re-validated offline against `agents/gate-policy.json`: structural schema,
   in-catalog and intra-PR deduplication, kebab-case tags, provider/URL-host
   consistency, minimum stars, license allow/deny lists, and excluded
   owners/repos/keywords. This composes with — rather than trusts — the
   curator's own `curator/src/validation`: even a validly-signed change must
   still satisfy policy here.
3. **Verifies the attestation.** `agent-attestation.json` must be signed by an
   `active` key of an `active` agent in the registry, and its subject digests
   must match the exact bytes of the gated files.

All three must hold. Any failure exits non-zero and blocks merge.

## Attestation format (`agent-attestation.json`)

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

The signed bytes are the canonical JSON serialization (recursively key-sorted)
of the whole object **with `signature.value` removed** — so the algorithm, key
id, agent id, timestamp, digests, and the mechanical assertion are all bound by
the signature and cannot be altered without invalidating it.

## Producing an attestation (approved agent)

After the change is on disk (i.e. `scripts/add-source.js` has updated
`sources.json` and regenerated `README.MD`):

```bash
node scripts/attest.js \
  --agent-id awesome-repo-graph-curator \
  --key-id curator-2026 \
  --key-file /path/to/private-key.pem     # or: AGENT_SIGNING_KEY=<pem contents>
```

Then stage `agent-attestation.json` together with `sources.json` and
`README.MD` in the same commit.

### Curator integration

The curator already shells out to `scripts/add-source.js`
(`curator/src/insertion/insert.ts`). To attach an attestation it runs
`scripts/attest.js` once per change — after all insertions and score refresh,
before the git commit — and adds `agent-attestation.json` to the set of staged
paths in its commit step. In CI the private key is provided by mapping a
repository secret (e.g. `CURATOR_SIGNING_KEY`) to the `AGENT_SIGNING_KEY`
environment variable for that step. No other curator change is required.

## Becoming an approved agent

1. **Generate a keypair:**

   ```bash
   node scripts/agent-keygen.js --agent-id my-agent --key-id my-agent-2026 \
     --private-out my-agent.key
   ```

   Keep `my-agent.key` secret — store it as a CI secret or a local key file.
   Never commit it.

2. **Register the public key.** Open a pull request adding the printed public
   registry block to the `agents` array in `agents/approved-agents.json`.

3. **Get it reviewed and merged.** `agents/approved-agents.json` is a protected
   path: changing it requires human review (CODEOWNERS / branch protection).
   This is deliberate — it prevents a contributor from both signing with their
   own key and self-approving that key in a single unreviewed change.

## Key rotation and revocation

Each agent can hold multiple keys. To rotate, add a new `active` key and set the
old key's `status` to `"revoked"` (never delete it — history stays auditable).
The verifier only accepts a signature from an `active` key of an `active` agent,
so a revoked key is rejected immediately. To pause an agent entirely, set its
agent-level `status` to anything other than `"active"`.

## Recommended branch protection

For the gate to be a true trust boundary, configure branch protection on the
default branch to:

- require the `approved-agent-gate` status check to pass before merge, and
- require review for changes to `agents/approved-agents.json` and
  `agents/gate-policy.json` (e.g. via CODEOWNERS).

The gate proves who/what produced a change; branch protection ensures the gate
and registry themselves cannot be bypassed or quietly rewritten.

## Files

| Path | Role |
|---|---|
| `agents/approved-agents.json` | Public registry of approved agents and their Ed25519 public keys. |
| `agents/gate-policy.json` | CI mirror of the offline-checkable mechanical policy thresholds. |
| `agent-attestation.json` | Per-change signed attestation (committed on the PR branch). |
| `scripts/attest.js` | Producer: signs and writes the attestation. |
| `scripts/verify-attestation.js` | Verifier: the CI check (policy re-check + signature). |
| `scripts/agent-keygen.js` | Generates an Ed25519 keypair for onboarding. |
| `scripts/lib/attestation.js` | Pure, dependency-free core (sign/verify/policy). |
| `.github/workflows/verify-agent.yml` | The required `approved-agent-gate` workflow. |
