import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const curatorSrcInsertionDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(curatorSrcInsertionDir, "..", "..", "..");
const REFRESH_SCRIPT = path.join(repoRoot, "scripts", "refresh-scores.js");

export interface ScoreRefreshResult {
  ran: boolean;
  succeeded: boolean;
  output: string;
  error: string | null;
}

/**
 * Runs the repository's existing scripts/refresh-scores.js, which updates
 * score.stars/license in place and never clears a value on a failed fetch
 * (see AGENTS.MD) — we don't duplicate that logic, only invoke it.
 */
export async function refreshScores(dryRun: boolean): Promise<ScoreRefreshResult> {
  if (dryRun) {
    return { ran: false, succeeded: true, output: "(skipped: dry run)", error: null };
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, [REFRESH_SCRIPT], { cwd: repoRoot });
    return { ran: true, succeeded: true, output: stdout.trim(), error: null };
  } catch (error) {
    return {
      ran: true,
      succeeded: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
