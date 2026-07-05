import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const curatorSrcGitDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(curatorSrcGitDir, "..", "..", "..");

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
  return stdout.trim();
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { cwd: repoRoot });
  return stdout.trim();
}

export async function getCurrentBranch(): Promise<string> {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function branchExistsLocally(branch: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function remoteBranchExists(branch: string): Promise<boolean> {
  try {
    const output = await git(["ls-remote", "--heads", "origin", branch]);
    return output.length > 0;
  } catch {
    return false;
  }
}

/** Checks out `branch`, creating it from the current HEAD if it doesn't exist yet. */
export async function ensureBranch(branch: string): Promise<void> {
  const exists = await branchExistsLocally(branch);
  if (exists) {
    await git(["checkout", branch]);
  } else {
    await git(["checkout", "-b", branch]);
  }
}

export async function checkoutBranch(branch: string): Promise<void> {
  await git(["checkout", branch]);
}

export async function hasUncommittedChanges(): Promise<boolean> {
  const status = await git(["status", "--porcelain"]);
  return status.length > 0;
}

export interface CommitResult {
  committed: boolean;
  sha: string | null;
  error: string | null;
}

/**
 * Stages exactly the given paths (never `git add -A`) and commits with a
 * deterministic message. No-op (committed:false) if nothing changed —
 * required for idempotent re-runs to not create empty commits.
 */
export async function stageAndCommit(paths: string[], message: string): Promise<CommitResult> {
  try {
    if (paths.length > 0) {
      await git(["add", "--", ...paths]);
    }
    const staged = await git(["diff", "--cached", "--name-only"]);
    if (staged.length === 0) {
      return { committed: false, sha: null, error: null };
    }
    await git(["commit", "-m", message]);
    const sha = await git(["rev-parse", "HEAD"]);
    return { committed: true, sha, error: null };
  } catch (error) {
    return { committed: false, sha: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Never force-pushes. Fails loudly (does not fall back to --force) if a non-fast-forward push is rejected. */
export async function pushBranch(branch: string): Promise<{ pushed: boolean; error: string | null }> {
  try {
    await git(["push", "--set-upstream", "origin", branch]);
    return { pushed: true, error: null };
  } catch (error) {
    return { pushed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface ExistingPullRequest {
  number: number;
  url: string;
}

export async function findOpenPullRequestForBranch(branch: string): Promise<ExistingPullRequest | null> {
  try {
    const output = await gh([
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,url",
    ]);
    const results = JSON.parse(output) as ExistingPullRequest[];
    return results[0] ?? null;
  } catch {
    return null;
  }
}

export interface PullRequestResult {
  created: boolean;
  updated: boolean;
  number: number | null;
  url: string | null;
  error: string | null;
}

/**
 * Creates one PR per successful run, or updates the same day's automation
 * PR in place if one is already open for this branch (avoids opening
 * duplicate PRs when a run is retried the same day).
 */
export async function createOrUpdatePullRequest(
  branch: string,
  base: string,
  title: string,
  body: string,
): Promise<PullRequestResult> {
  try {
    const existing = await findOpenPullRequestForBranch(branch);
    if (existing) {
      await gh(["pr", "edit", String(existing.number), "--title", title, "--body", body]);
      return { created: false, updated: true, number: existing.number, url: existing.url, error: null };
    }

    const url = await gh([
      "pr",
      "create",
      "--head",
      branch,
      "--base",
      base,
      "--title",
      title,
      "--body",
      body,
    ]);
    const numberMatch = url.match(/\/pull\/(\d+)/);
    return {
      created: true,
      updated: false,
      number: numberMatch ? Number(numberMatch[1]) : null,
      url,
      error: null,
    };
  } catch (error) {
    return {
      created: false,
      updated: false,
      number: null,
      url: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface DispatchWorkflowResult {
  dispatched: boolean;
  error: string | null;
}

/**
 * Dispatches another workflow via `gh workflow run` (a workflow_dispatch
 * event), never via a push. This is intentionally one-directional: the
 * deploy workflow only builds web/out and never touches curator/ or
 * triggers curate.yml back, so calling this cannot create a workflow loop.
 * Only call this after confirming a real change landed on `ref` — dispatching
 * unconditionally would rebuild/redeploy identical content on every run.
 */
export async function dispatchWorkflow(workflowFile: string, ref: string): Promise<DispatchWorkflowResult> {
  try {
    await gh(["workflow", "run", workflowFile, "--ref", ref]);
    return { dispatched: true, error: null };
  } catch (error) {
    return { dispatched: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getDefaultBranch(): Promise<string> {
  try {
    const ref = await git(["symbolic-ref", "refs/remotes/origin/HEAD"]);
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}
