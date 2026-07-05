"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  canonicalize,
  computeDigest,
  signAttestation,
  verifyAttestation,
  validateAddedEntries,
} = require("../lib/attestation");

// --- helpers ----------------------------------------------------------------

function makeAgent(id = "test-agent", keyId = "test-key-2026") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const registry = {
    schemaVersion: 1,
    agents: [
      {
        id,
        name: "Test Agent",
        status: "active",
        keys: [{ keyId, algorithm: "ed25519", status: "active", publicKey: publicPem, addedAt: "2026-07-05" }],
      },
    ],
  };
  return { id, keyId, privateKey, publicPem, registry };
}

const SOURCES = '{"sources":[]}\n';
const README = "# awesome-repo-graph\n";

function filesFor(sources = SOURCES, readme = README) {
  return { "sources.json": sources, "README.MD": readme };
}

function attestFor(agent, files = filesFor()) {
  const subject = {};
  for (const [name, content] of Object.entries(files)) subject[name] = computeDigest(content);
  return signAttestation({ agentId: agent.id, keyId: agent.keyId, subject, privateKey: agent.privateKey });
}

// --- canonicalization / digest ---------------------------------------------

test("canonicalize is stable regardless of key insertion order", () => {
  assert.equal(canonicalize({ b: 1, a: [3, { y: 2, x: 1 }] }), canonicalize({ a: [3, { x: 1, y: 2 }], b: 1 }));
});

test("computeDigest is deterministic and sha256-prefixed", () => {
  assert.equal(computeDigest("hello"), computeDigest(Buffer.from("hello")));
  assert.match(computeDigest("hello"), /^sha256:[0-9a-f]{64}$/);
});

// --- required cases ---------------------------------------------------------

test("accepts a well-formed attestation from an approved agent", () => {
  const agent = makeAgent();
  const files = filesFor();
  const attestation = attestFor(agent, files);
  const result = verifyAttestation({ attestation, registry: agent.registry, files });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual(result.errors, []);
  assert.equal(result.agentId, agent.id);
});

test("rejects an attestation from an unknown agent", () => {
  const agent = makeAgent();
  const files = filesFor();
  const attestation = attestFor(agent, files);
  attestation.agentId = "somebody-else"; // not in the registry
  const result = verifyAttestation({ attestation, registry: agent.registry, files });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("not in the approved registry")));
});

test("rejects a valid signature from a key not registered to the agent", () => {
  // A contributor self-signs with their own keypair — the signature is
  // internally valid but the key is not in the registry.
  const agent = makeAgent();
  const rogue = makeAgent(agent.id, agent.keyId); // same ids, different key material
  const files = filesFor();
  const attestation = attestFor(rogue, files);
  const result = verifyAttestation({ attestation, registry: agent.registry, files });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("does not verify")));
});

test("rejects a tampered file (digest mismatch)", () => {
  const agent = makeAgent();
  const attestation = attestFor(agent, filesFor());
  // The shipped sources.json differs from what was attested.
  const tampered = filesFor('{"sources":[{"id":"sneaky"}]}\n');
  const result = verifyAttestation({ attestation, registry: agent.registry, files: tampered });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("digest mismatch")));
});

test("rejects a replayed attestation reused for different content", () => {
  const agent = makeAgent();
  // Genuine attestation over the original content...
  const attestation = attestFor(agent, filesFor());
  // ...reused verbatim to bless an unvetted change.
  const other = filesFor('{"sources":[{"id":"unvetted","url":"https://github.com/x/y"}]}\n');
  const result = verifyAttestation({ attestation, registry: agent.registry, files: other });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("digest mismatch")));
});

test("rejects a mutated signed field (agentId swap invalidates signature)", () => {
  const agent = makeAgent("test-agent", "test-key-2026");
  // Add a second approved agent so the swapped id is a known agent, forcing
  // the failure to come from the signature, not the registry lookup.
  const second = crypto.generateKeyPairSync("ed25519");
  agent.registry.agents.push({
    id: "other-approved",
    status: "active",
    keys: [
      {
        keyId: "test-key-2026",
        algorithm: "ed25519",
        status: "active",
        publicKey: second.publicKey.export({ type: "spki", format: "pem" }).toString(),
        addedAt: "2026-07-05",
      },
    ],
  });
  const files = filesFor();
  const attestation = attestFor(agent, files);
  attestation.agentId = "other-approved"; // known agent, but signature was over the original id
  const result = verifyAttestation({ attestation, registry: agent.registry, files });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("does not verify")));
});

test("rejects a revoked key", () => {
  const agent = makeAgent();
  agent.registry.agents[0].keys[0].status = "revoked";
  const files = filesFor();
  const attestation = attestFor(agent, files);
  const result = verifyAttestation({ attestation, registry: agent.registry, files });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("not active")));
});

test("rejects an inactive agent", () => {
  const agent = makeAgent();
  agent.registry.agents[0].status = "suspended";
  const files = filesFor();
  const attestation = attestFor(agent, files);
  const result = verifyAttestation({ attestation, registry: agent.registry, files });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("is not active")));
});

test("rejects a missing/undefined attestation", () => {
  const agent = makeAgent();
  const result = verifyAttestation({ attestation: undefined, registry: agent.registry, files: filesFor() });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("missing")));
});

test("rejects an attestation that does not cover a gated file", () => {
  const agent = makeAgent();
  const attestation = attestFor(agent, filesFor());
  delete attestation.subject["README.MD"];
  // Re-sign so the (now incomplete) subject is consistent, isolating the
  // "does not cover" check from a signature failure.
  const resigned = signAttestation({
    agentId: agent.id,
    keyId: agent.keyId,
    subject: attestation.subject,
    privateKey: agent.privateKey,
  });
  const result = verifyAttestation({ attestation: resigned, registry: agent.registry, files: filesFor() });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('does not cover file "README.MD"')));
});

// --- end-to-end producer -> verifier loop -----------------------------------

test("end-to-end: keygen -> sign -> verify round-trips", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const registry = {
    schemaVersion: 1,
    agents: [
      {
        id: "e2e-agent",
        status: "active",
        keys: [
          {
            keyId: "e2e-2026",
            algorithm: "ed25519",
            status: "active",
            publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
            addedAt: "2026-07-05",
          },
        ],
      },
    ],
  };
  const files = filesFor('{"sources":[{"id":"real"}]}\n', "# readme\n");
  const subject = {};
  for (const [name, content] of Object.entries(files)) subject[name] = computeDigest(content);
  const attestation = signAttestation({ agentId: "e2e-agent", keyId: "e2e-2026", subject, privateKey });
  const result = verifyAttestation({ attestation, registry, files });
  assert.equal(result.ok, true, result.errors.join("; "));
});

// --- mechanical policy re-check ---------------------------------------------

const validEntry = {
  id: "owner-repo",
  url: "https://github.com/owner/repo",
  provider: "github.com",
  owner: "owner",
  repo: "repo",
  title: "repo",
  description: "",
  path: ["Frontend Engineering", "GSAP"],
  tags: ["gsap", "landing-page"],
  license: "MIT",
  score: { stars: 100, fetchedAt: "2026-07-05" },
};

test("policy re-check passes for a clean added entry", () => {
  const result = validateAddedEntries([], [validEntry], {});
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual(result.addedIds, ["owner-repo"]);
});

test("policy re-check ignores unchanged base entries", () => {
  const result = validateAddedEntries([validEntry], [validEntry], { minStars: 1000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.addedIds, []);
});

test("policy re-check rejects a non-kebab-case tag", () => {
  const bad = { ...validEntry, tags: ["GSAP"] };
  const result = validateAddedEntries([], [bad], {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("non-kebab-case tag")));
});

test("policy re-check rejects an in-catalog duplicate URL", () => {
  const dup = { ...validEntry, id: "owner-repo-2", url: "https://github.com/owner/repo/" };
  const result = validateAddedEntries([validEntry], [validEntry, dup], {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("duplicates a URL already in the catalog")));
});

test("policy re-check rejects two added entries with the same URL", () => {
  const a = { ...validEntry, id: "a" };
  const b = { ...validEntry, id: "b" };
  const result = validateAddedEntries([], [a, b], {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("duplicates another added entry")));
});

test("policy re-check enforces min-stars from policy", () => {
  const result = validateAddedEntries([], [validEntry], { minStars: 500 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("below the minimum")));
});

test("policy re-check enforces license denylist and exclusion lists", () => {
  const denied = validateAddedEntries([], [validEntry], { licenseDenylist: ["MIT"] });
  assert.equal(denied.ok, false);
  assert.ok(denied.errors.some((e) => e.includes("denied license")));

  const excludedOwner = validateAddedEntries([], [validEntry], { excludedOwners: ["owner"] });
  assert.equal(excludedOwner.ok, false);
  assert.ok(excludedOwner.errors.some((e) => e.includes("excluded owner")));
});

test("policy re-check rejects a provider that disagrees with the URL host", () => {
  const bad = { ...validEntry, provider: "gitlab.com" };
  const result = validateAddedEntries([], [bad], {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("does not match URL host")));
});

test("policy re-check rejects an entry with an empty taxonomy path", () => {
  const bad = { ...validEntry, path: [] };
  const result = validateAddedEntries([], [bad], {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("empty or missing taxonomy")));
});
