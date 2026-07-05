#!/usr/bin/env node
"use strict";

// Generates an Ed25519 keypair for onboarding a new approved agent.
//
//   node scripts/agent-keygen.js --agent-id my-agent --key-id my-agent-2026
//
// Prints the PUBLIC key block to paste into agents/approved-agents.json and,
// by default, prints the PRIVATE key to stdout so you can store it as a CI
// secret (e.g. CURATOR_SIGNING_KEY) or a local key file. NEVER commit the
// private key. Pass --private-out <path> to write it to a file instead of
// printing it. The public key is the only key material that belongs in git.

const crypto = require("crypto");
const fs = require("fs");

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const agentId = args["agent-id"] || "new-agent";
  const keyId = args["key-id"] || `${agentId}-${new Date().getFullYear()}`;

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();

  const registryBlock = {
    id: agentId,
    name: `${agentId} (rename me)`,
    status: "active",
    keys: [
      {
        keyId,
        algorithm: "ed25519",
        status: "active",
        publicKey: publicPem,
        addedAt: new Date().toISOString().slice(0, 10),
      },
    ],
  };

  console.log("# Public registry block — add to agents/approved-agents.json's \"agents\" array:\n");
  console.log(JSON.stringify(registryBlock, null, 2));

  if (args["private-out"] && args["private-out"] !== "true") {
    fs.writeFileSync(args["private-out"], privatePem + "\n", { mode: 0o600 });
    console.log(`\n# Private key written to ${args["private-out"]} (keep it secret; never commit it).`);
  } else {
    console.log("\n# Private key (store as a CI secret or key file; NEVER commit it):\n");
    console.log(privatePem);
  }
}

main();
