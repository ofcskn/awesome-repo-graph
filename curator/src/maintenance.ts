import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const curatorSrcDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(curatorSrcDir, "..", "..");
const webDir = path.join(repoRoot, "web");

export interface BuildResult {
  ran: boolean;
  succeeded: boolean;
  error: string | null;
}

/** Runs `npm run build` in web/ — the same command deploy-pages.yml uses. */
export async function buildWebApp(enabled: boolean): Promise<BuildResult> {
  if (!enabled) return { ran: false, succeeded: true, error: null };
  try {
    await execFileAsync("npm", ["run", "build"], { cwd: webDir });
    return { ran: true, succeeded: true, error: null };
  } catch (error) {
    return { ran: true, succeeded: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface SmokeTestResult {
  ran: boolean;
  succeeded: boolean;
  checks: { name: string; passed: boolean }[];
  error: string | null;
}

/**
 * A minimal, dependency-free smoke check on the static export: confirms
 * web/out/index.html exists and contains freshly-added source URLs. This
 * intentionally does not stand up a browser (no e2e framework exists in
 * this repo today — see docs/curator.md's "Known limitations").
 */
export async function runSmokeTests(enabled: boolean, acceptedUrls: string[]): Promise<SmokeTestResult> {
  if (!enabled) return { ran: false, succeeded: true, checks: [], error: null };

  const indexPath = path.join(webDir, "out", "index.html");
  if (!fs.existsSync(indexPath)) {
    return {
      ran: true,
      succeeded: false,
      checks: [{ name: "web/out/index.html exists", passed: false }],
      error: "web/out/index.html not found — did buildWebApp run first?",
    };
  }

  const html = fs.readFileSync(indexPath, "utf8");
  const checks = [
    { name: "web/out/index.html exists", passed: true },
    ...acceptedUrls.map((url) => ({
      name: `catalog/graph data contains ${url}`,
      passed: html.includes(url),
    })),
  ];

  return {
    ran: true,
    succeeded: checks.every((c) => c.passed),
    checks,
    error: null,
  };
}
