import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const curatorSrcGitDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(curatorSrcGitDir, "..", "..", "..");

/** Repo-relative path of the attestation the producer script writes. */
export const ATTESTATION_PATH = "agent-attestation.json";

export interface AttestationResult {
  /** True when agent-attestation.json was produced and should be staged. */
  created: boolean;
  /** True when no signing key was available and the step was intentionally skipped. */
  skipped: boolean;
  /** Repo-relative path to stage, when `created`. */
  path: string | null;
  /** Populated only on a real failure (never on a deliberate skip). */
  error: string | null;
}

export interface AttestationOptions {
  agentId: string;
  keyId: string;
  /** Optional PEM path for sanctioned local runs; CI uses AGENT_SIGNING_KEY instead. */
  keyFile?: string;
}

/**
 * Produces the approved-agent attestation for the just-inserted catalog change
 * by invoking scripts/attest.js, so the resulting PR passes the
 * approved-agent gate (.github/workflows/verify-agent.yml).
 *
 * Fail-open by design: if no signing key is present (neither AGENT_SIGNING_KEY
 * nor a key file), the step is *skipped*, not failed — a maintainer running
 * locally without the key still gets a normal commit, it just won't satisfy
 * the gate until re-signed. The key is only ever read by name/path; this
 * module never handles key material directly.
 */
export async function generateAttestation(options: AttestationOptions): Promise<AttestationResult> {
  const hasEnvKey = typeof process.env.AGENT_SIGNING_KEY === "string" && process.env.AGENT_SIGNING_KEY.length > 0;
  const hasFileKey = typeof options.keyFile === "string" && options.keyFile.length > 0;
  if (!hasEnvKey && !hasFileKey) {
    return { created: false, skipped: true, path: null, error: null };
  }

  const args = ["scripts/attest.js", "--agent-id", options.agentId, "--key-id", options.keyId];
  if (hasFileKey) {
    args.push("--key-file", options.keyFile as string);
  }

  try {
    await execFileAsync("node", args, { cwd: repoRoot });
    return { created: true, skipped: false, path: ATTESTATION_PATH, error: null };
  } catch (error) {
    return {
      created: false,
      skipped: false,
      path: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
