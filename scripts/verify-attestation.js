#!/usr/bin/env node
"use strict";

// Verifier side of the approved-agent gate. Run in CI on every pull request
// as the required `approved-agent-gate` check:
//
//   node scripts/verify-attestation.js --base-ref origin/main
//
// It performs, in order:
//   1. Change detection — if neither sources.json nor README.MD changed vs the
//      base, there is nothing to gate; exit 0.
//   2. Mechanical policy re-check — the newly-added sources.json entries are
//      re-validated offline against agents/gate-policy.json (schema, dedup,
//      tag format, min-stars, license, exclusion lists). This composes with,
//      rather than trusts, the curator's own mechanical validation.
//   3. Attestation verification — agent-attestation.json must be signed by an
//      active key of an active agent in agents/approved-agents.json AND its
//      subject digests must match the exact bytes of the gated files.
//
// Any failure exits non-zero, failing the required check and blocking merge.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { verifyAttestation, validateAddedEntries } = require("./lib/attestation");

const repoRoot = path.join(__dirname, "..");
const GATED_FILES = ["sources.json", "README.MD"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args[key] = value;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function git(gitArgs) {
  return execFileSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" });
}

/** Files changed between the base ref and the working tree (committed HEAD). */
function changedFiles(baseRef) {
  try {
    const out = git(["diff", "--name-only", `${baseRef}...HEAD`]);
    return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch (err) {
    // If we cannot compute a diff (e.g. shallow checkout without the base),
    // fail closed: treat the catalog as changed so the gate still enforces.
    console.warn(`Could not diff against ${baseRef} (${err.message}); enforcing gate.`);
    return new Set(GATED_FILES);
  }
}

/** The base version of sources.json, or an empty catalog if it did not exist. */
function baseSources(baseRef) {
  try {
    const raw = git(["show", `${baseRef}:sources.json`]);
    const data = JSON.parse(raw);
    return Array.isArray(data.sources) ? data.sources : [];
  } catch {
    return [];
  }
}

function fail(message, errors) {
  console.error(`\n✗ ${message}`);
  for (const e of errors || []) console.error(`  - ${e}`);
  process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseRef = args["base-ref"] && args["base-ref"] !== "true" ? args["base-ref"] : "origin/main";

  const changed = changedFiles(baseRef);
  const catalogTouched = GATED_FILES.some((f) => changed.has(f));
  if (!catalogTouched) {
    console.log("No changes to sources.json or README.MD — approved-agent gate not required.");
    return;
  }

  // Step 2: mechanical policy re-check on the added entries.
  let policy = {};
  try {
    policy = readJson(path.join(repoRoot, "agents", "gate-policy.json"));
  } catch (err) {
    fail(`Cannot read agents/gate-policy.json: ${err.message}`);
    return;
  }

  let headSources;
  try {
    const data = readJson(path.join(repoRoot, "sources.json"));
    headSources = Array.isArray(data.sources) ? data.sources : [];
  } catch (err) {
    fail(`Cannot read sources.json: ${err.message}`);
    return;
  }

  const policyResult = validateAddedEntries(baseSources(baseRef), headSources, policy);
  if (!policyResult.ok) {
    fail("Mechanical policy re-check failed for the added catalog entries.", policyResult.errors);
    return;
  }
  console.log(
    policyResult.addedIds.length > 0
      ? `Mechanical policy re-check passed for ${policyResult.addedIds.length} added entr${
          policyResult.addedIds.length === 1 ? "y" : "ies"
        }.`
      : "Mechanical policy re-check passed (no newly-added entries).",
  );

  // Step 3: attestation verification.
  const attestationPath = path.join(repoRoot, "agent-attestation.json");
  if (!fs.existsSync(attestationPath)) {
    fail(
      "The catalog changed but agent-attestation.json is missing.",
      ["A change to sources.json/README.MD must carry an attestation from an approved agent (see docs/agent-gateway.md)."],
    );
    return;
  }

  let attestation;
  let registry;
  try {
    attestation = readJson(attestationPath);
  } catch (err) {
    fail(`agent-attestation.json is not valid JSON: ${err.message}`);
    return;
  }
  try {
    registry = readJson(path.join(repoRoot, "agents", "approved-agents.json"));
  } catch (err) {
    fail(`Cannot read agents/approved-agents.json: ${err.message}`);
    return;
  }

  const files = {};
  for (const name of GATED_FILES) {
    files[name] = fs.readFileSync(path.join(repoRoot, name));
  }

  const result = verifyAttestation({ attestation, registry, files });
  if (!result.ok) {
    fail("Attestation verification failed.", result.errors);
    return;
  }

  console.log(`\n✓ approved-agent gate passed — attested by "${result.agentId}" (key "${result.keyId}").`);
}

main();
