#!/usr/bin/env node
"use strict";

// Producer side of the approved-agent gate: an approved agent runs this after
// producing a catalog change (i.e. after scripts/add-source.js has updated
// sources.json and regenerated README.MD) to emit agent-attestation.json.
//
//   node scripts/attest.js \
//     --agent-id awesome-repo-graph-curator \
//     --key-id curator-2026 \
//     --key-file /path/to/private-key.pem
//
// The private key is supplied by NAME/PATH only and never touches the repo:
//   --key-file <path>   read the PEM from a file (local sanctioned runs), or
//   AGENT_SIGNING_KEY    env var holding the PEM contents (CI: map a secret
//                        such as CURATOR_SIGNING_KEY to it).
//
// Curator integration point: the curator already shells out to
// scripts/add-source.js (see curator/src/insertion/insert.ts). To attach an
// attestation it runs this script once per change, after all insertions and
// before the git commit, then stages agent-attestation.json alongside
// sources.json/README.MD. No curator source change is required beyond that
// one extra exec + staged path.

const fs = require("fs");
const path = require("path");
const { signAttestation, computeDigest } = require("./lib/attestation");

const repoRoot = path.join(__dirname, "..");
const GATED_FILES = ["sources.json", "README.MD"];
const ATTESTATION_PATH = path.join(repoRoot, "agent-attestation.json");

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

function loadPrivateKey(args) {
  if (args["key-file"] && args["key-file"] !== "true") {
    return fs.readFileSync(args["key-file"], "utf8");
  }
  if (process.env.AGENT_SIGNING_KEY) {
    return process.env.AGENT_SIGNING_KEY;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const agentId = args["agent-id"];
  const keyId = args["key-id"];

  if (!agentId || !keyId) {
    console.error(
      "Usage: node scripts/attest.js --agent-id <id> --key-id <keyId> (--key-file <path> | AGENT_SIGNING_KEY=<pem>)",
    );
    process.exitCode = 1;
    return;
  }

  const privateKey = loadPrivateKey(args);
  if (!privateKey) {
    console.error(
      "No signing key provided. Pass --key-file <path> or set AGENT_SIGNING_KEY to the PEM contents (referenced by name, never committed).",
    );
    process.exitCode = 1;
    return;
  }

  const subject = {};
  for (const name of GATED_FILES) {
    const filePath = path.join(repoRoot, name);
    if (!fs.existsSync(filePath)) {
      console.error(`Cannot attest: gated file "${name}" does not exist at repo root.`);
      process.exitCode = 1;
      return;
    }
    subject[name] = computeDigest(fs.readFileSync(filePath));
  }

  let attestation;
  try {
    attestation = signAttestation({
      agentId,
      keyId,
      subject,
      privateKey,
      mechanicalValidated: args["mechanical-validated"] !== "false",
      validator: args.validator && args.validator !== "true" ? args.validator : undefined,
    });
  } catch (err) {
    console.error(`Failed to sign attestation: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(ATTESTATION_PATH, JSON.stringify(attestation, null, 2) + "\n");
  console.log(`Wrote agent-attestation.json for agent "${agentId}" (key "${keyId}").`);
  for (const [name, digest] of Object.entries(subject)) {
    console.log(`  ${name}: ${digest}`);
  }
}

main();
