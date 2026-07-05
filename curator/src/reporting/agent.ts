import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const reportingDir = fileURLToPath(new URL(".", import.meta.url));
/** curator/package.json — the source of the agent's own name + version. */
const PACKAGE_JSON_PATH = path.resolve(reportingDir, "..", "..", "package.json");

export interface AgentMetadata {
  name: string;
  version: string;
}

/**
 * Reads the curator's own name + version from its package.json.
 *
 * Deliberately reads ONLY `name` and `version` — never `author`, git
 * identity, or any other field — so no owner/PII can leak into a report or
 * the committed ledger. Falls back to safe placeholders if the file is
 * missing or malformed rather than throwing (metadata must never break a run).
 */
export function readAgentMetadata(packageJsonPath: string = PACKAGE_JSON_PATH): AgentMetadata {
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : "unknown-agent",
      version: typeof parsed.version === "string" ? parsed.version : "0.0.0",
    };
  } catch {
    return { name: "unknown-agent", version: "0.0.0" };
  }
}
