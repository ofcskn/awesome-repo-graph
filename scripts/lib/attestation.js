"use strict";

// Core, dependency-free primitives for the approved-agent contribution gate.
//
// Everything here is a pure function over in-memory values so it can be unit
// tested without touching the filesystem, the network, or git. The CLI
// wrappers (scripts/attest.js, scripts/verify-attestation.js) are the only
// place that does I/O.
//
// Trust model: an approved agent signs a canonical attestation envelope that
// binds its identity (agentId + keyId, both listed in a public registry) to
// SHA-256 digests of the gated files. CI recomputes the digests and verifies
// the Ed25519 signature against the registry's public key. See
// docs/agent-gateway.md.

const crypto = require("crypto");

const SCHEMA_VERSION = 1;
const SIGNATURE_ALGORITHM = "ed25519";

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * every depth and arrays keep their order. Two structurally-equal values
 * always produce byte-identical output, which is what makes a signature over
 * the result reproducible between the producer and the verifier.
 */
function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
  return `{${entries.join(",")}}`;
}

/** Returns "sha256:<hex>" for a Buffer or string. */
function computeDigest(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

/**
 * The exact bytes that get signed/verified: the whole attestation object with
 * signature.value stripped out. Everything else — algorithm, keyId, agentId,
 * timestamp, subject digests, the mechanical assertion — is therefore bound by
 * the signature and cannot be swapped without invalidating it.
 */
function buildSigningPayload(attestation) {
  const clone = JSON.parse(JSON.stringify(attestation));
  if (clone.signature && typeof clone.signature === "object") {
    delete clone.signature.value;
  }
  return Buffer.from(canonicalize(clone), "utf8");
}

/**
 * Produces a signed attestation object.
 *
 * @param {object} params
 * @param {string} params.agentId
 * @param {string} params.keyId
 * @param {Record<string,string>} params.subject  file name -> "sha256:..." digest
 * @param {string|crypto.KeyObject} params.privateKey  Ed25519 private key (PEM or KeyObject)
 * @param {string} [params.producedAt]  ISO timestamp; defaults to now
 * @param {boolean} [params.mechanicalValidated]
 * @param {string} [params.validator]
 */
function signAttestation(params) {
  const {
    agentId,
    keyId,
    subject,
    privateKey,
    producedAt = new Date().toISOString(),
    mechanicalValidated = true,
    validator = "curator/src/validation",
  } = params;

  const attestation = {
    schemaVersion: SCHEMA_VERSION,
    agentId,
    producedAt,
    subject,
    mechanical: { validated: mechanicalValidated, validator },
    signature: { algorithm: SIGNATURE_ALGORITHM, keyId },
  };

  const key = typeof privateKey === "string" ? crypto.createPrivateKey(privateKey) : privateKey;
  const signature = crypto.sign(null, buildSigningPayload(attestation), key);
  attestation.signature.value = signature.toString("base64");
  return attestation;
}

function findAgent(registry, agentId) {
  if (!registry || !Array.isArray(registry.agents)) return null;
  return registry.agents.find((a) => a && a.id === agentId) || null;
}

function findKey(agent, keyId) {
  if (!agent || !Array.isArray(agent.keys)) return null;
  return agent.keys.find((k) => k && k.keyId === keyId) || null;
}

/**
 * Verifies an attestation against a registry and the actual file contents.
 *
 * @param {object} params
 * @param {object} params.attestation
 * @param {object} params.registry
 * @param {Record<string,Buffer|string>} params.files  gated file name -> content
 * @returns {{ ok: boolean, errors: string[], agentId: string|null, keyId: string|null }}
 */
function verifyAttestation(params) {
  const { attestation, registry, files } = params;
  const errors = [];

  if (!attestation || typeof attestation !== "object") {
    return { ok: false, errors: ["attestation is missing or not an object"], agentId: null, keyId: null };
  }
  if (attestation.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion: ${attestation.schemaVersion}`);
  }

  const agentId = typeof attestation.agentId === "string" ? attestation.agentId : null;
  const signature = attestation.signature;
  const keyId = signature && typeof signature.keyId === "string" ? signature.keyId : null;

  if (!agentId) errors.push("attestation.agentId is missing");
  if (!signature || typeof signature !== "object") errors.push("attestation.signature is missing");
  if (signature && signature.algorithm !== SIGNATURE_ALGORITHM) {
    errors.push(`unsupported signature algorithm: ${signature && signature.algorithm}`);
  }
  if (!keyId) errors.push("attestation.signature.keyId is missing");
  if (!signature || typeof signature.value !== "string" || signature.value.length === 0) {
    errors.push("attestation.signature.value is missing");
  }

  // Subject-digest binding: every gated file must be listed and must match.
  const subject = attestation.subject && typeof attestation.subject === "object" ? attestation.subject : {};
  for (const [name, content] of Object.entries(files || {})) {
    const expected = subject[name];
    if (!expected) {
      errors.push(`attestation does not cover file "${name}"`);
      continue;
    }
    const actual = computeDigest(content);
    if (actual !== expected) {
      errors.push(`digest mismatch for "${name}" (attested ${expected}, actual ${actual})`);
    }
  }

  // Identity: agent + key must exist and be active in the public registry.
  const agent = findAgent(registry, agentId);
  if (!agent) {
    errors.push(`agent "${agentId}" is not in the approved registry`);
  } else if (agent.status !== "active") {
    errors.push(`agent "${agentId}" is not active (status: ${agent.status})`);
  }

  let publicKeyPem = null;
  if (agent && keyId) {
    const key = findKey(agent, keyId);
    if (!key) {
      errors.push(`key "${keyId}" is not registered for agent "${agentId}"`);
    } else if (key.status !== "active") {
      errors.push(`key "${keyId}" is not active (status: ${key.status})`);
    } else if (key.algorithm !== SIGNATURE_ALGORITHM) {
      errors.push(`registered key "${keyId}" has algorithm ${key.algorithm}, expected ${SIGNATURE_ALGORITHM}`);
    } else {
      publicKeyPem = key.publicKey;
    }
  }

  // Signature: only checked once we have a public key and a signature value,
  // so verification errors are reported distinctly from lookup errors.
  if (publicKeyPem && signature && typeof signature.value === "string" && signature.value.length > 0) {
    let signatureValid = false;
    try {
      signatureValid = crypto.verify(
        null,
        buildSigningPayload(attestation),
        crypto.createPublicKey(publicKeyPem),
        Buffer.from(signature.value, "base64"),
      );
    } catch (err) {
      errors.push(`signature verification threw: ${err.message}`);
    }
    if (!signatureValid) {
      errors.push("signature does not verify against the registered public key");
    }
  }

  return { ok: errors.length === 0, errors, agentId, keyId };
}

// --- Mechanical policy re-check (CI-side, offline) --------------------------

function isKebabCase(tag) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag);
}

function normalizeUrlForDedup(rawUrl) {
  const u = new URL(rawUrl);
  const pathname = u.pathname.replace(/\/+$/, "");
  return `${u.hostname.toLowerCase()}${pathname}`;
}

/**
 * Re-validates the entries that a PR adds to sources.json against the subset
 * of the mechanical policy that is checkable offline from committed data. This
 * intentionally mirrors curator/src/validation (schema/dedup/tags) and the
 * curator config's quality thresholds — supplied here via `policy` so the two
 * cannot silently drift. It never reaches the network, so live-metadata gates
 * (age, activity, fork/archive state) stay with the curator; the values that
 * are frozen into the committed entry (stars, license) are re-checked here.
 *
 * @param {object[]} baseSources  sources array from the PR base
 * @param {object[]} headSources  sources array from the PR head
 * @param {object} policy         gate-policy.json contents
 * @returns {{ ok: boolean, errors: string[], addedIds: string[] }}
 */
function validateAddedEntries(baseSources, headSources, policy) {
  const errors = [];
  const baseUrls = new Set((baseSources || []).map((s) => safeNormalize(s.url)).filter(Boolean));
  const baseIds = new Set((baseSources || []).map((s) => s.id));

  const added = (headSources || []).filter((s) => !baseIds.has(s.id));
  const seenInAdded = new Map();
  const {
    minStars = 0,
    licenseDenylist = [],
    licenseAllowlist = [],
    excludedOwners = [],
    excludedRepos = [],
    excludedKeywords = [],
  } = policy || {};

  for (const entry of added) {
    const label = entry && entry.id ? `entry "${entry.id}"` : "an added entry";

    if (!entry || typeof entry !== "object") {
      errors.push(`${label} is not an object`);
      continue;
    }
    // Schema essentials.
    for (const field of ["id", "url", "provider"]) {
      if (typeof entry[field] !== "string" || entry[field].length === 0) {
        errors.push(`${label} is missing required string field "${field}"`);
      }
    }
    if (!Array.isArray(entry.path) || entry.path.length === 0) {
      errors.push(`${label} has an empty or missing taxonomy "path"`);
    }
    if (!Array.isArray(entry.tags)) {
      errors.push(`${label} has a missing "tags" array`);
    } else {
      for (const tag of entry.tags) {
        if (typeof tag !== "string" || !isKebabCase(tag)) {
          errors.push(`${label} has a non-kebab-case tag: ${JSON.stringify(tag)}`);
        }
      }
    }

    // URL validity + provider consistency.
    let normalized = null;
    if (typeof entry.url === "string") {
      try {
        const u = new URL(entry.url);
        normalized = normalizeUrlForDedup(entry.url);
        if (entry.provider && u.hostname.toLowerCase() !== String(entry.provider).toLowerCase()) {
          errors.push(`${label} provider "${entry.provider}" does not match URL host "${u.hostname}"`);
        }
      } catch {
        errors.push(`${label} has an invalid URL: ${JSON.stringify(entry.url)}`);
      }
    }

    // Dedup: against the base catalog and against other added entries.
    if (normalized) {
      if (baseUrls.has(normalized)) {
        errors.push(`${label} duplicates a URL already in the catalog: ${entry.url}`);
      }
      if (seenInAdded.has(normalized)) {
        errors.push(`${label} duplicates another added entry's URL: ${entry.url}`);
      }
      seenInAdded.set(normalized, entry.id);
    }

    // Policy thresholds checkable from committed data.
    const stars = entry.score && typeof entry.score.stars === "number" ? entry.score.stars : null;
    if (stars !== null && stars < minStars) {
      errors.push(`${label} has ${stars} stars, below the minimum of ${minStars}`);
    }
    if (entry.license) {
      if (licenseDenylist.includes(entry.license)) {
        errors.push(`${label} has a denied license: ${entry.license}`);
      } else if (licenseAllowlist.length > 0 && !licenseAllowlist.includes(entry.license)) {
        errors.push(`${label} has a non-allowlisted license: ${entry.license}`);
      }
    }
    if (entry.owner && excludedOwners.includes(entry.owner)) {
      errors.push(`${label} has an excluded owner: ${entry.owner}`);
    }
    if (entry.owner && entry.repo && excludedRepos.includes(`${entry.owner}/${entry.repo}`)) {
      errors.push(`${label} is an excluded repo: ${entry.owner}/${entry.repo}`);
    }
    const haystack = `${entry.title || ""} ${entry.description || ""}`.toLowerCase();
    for (const keyword of excludedKeywords) {
      if (haystack.includes(String(keyword).toLowerCase())) {
        errors.push(`${label} matches an excluded keyword: ${keyword}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, addedIds: added.map((e) => e && e.id).filter(Boolean) };
}

function safeNormalize(rawUrl) {
  try {
    return normalizeUrlForDedup(rawUrl);
  } catch {
    return null;
  }
}

module.exports = {
  SCHEMA_VERSION,
  SIGNATURE_ALGORITHM,
  canonicalize,
  computeDigest,
  buildSigningPayload,
  signAttestation,
  verifyAttestation,
  validateAddedEntries,
};
