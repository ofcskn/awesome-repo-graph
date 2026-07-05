import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadSources, normalizeSourceUrl } from "../store-bridge.js";
import type { Candidate, Classification, InsertionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const curatorSrcInsertionDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(curatorSrcInsertionDir, "..", "..", "..");
const ADD_SOURCE_SCRIPT = path.join(repoRoot, "scripts", "add-source.js");

/**
 * scripts/add-source.js's hand-rolled arg parser treats any token starting
 * with "--" as a new flag, and splits --path on ">" / --tags on ",". An AI
 * classification field containing those characters would silently corrupt
 * argv alignment or the taxonomy/tag split, not throw — so we reject those
 * values here rather than pass them through.
 */
function isSafeArgValue(value: string): boolean {
  return !value.trim().startsWith("--");
}

function validateClassificationForInsertion(classification: Classification): string | null {
  if (!isSafeArgValue(classification.title)) return "title begins with '--'";
  if (!isSafeArgValue(classification.description)) return "description begins with '--'";
  for (const segment of classification.taxonomyPath) {
    if (!isSafeArgValue(segment)) return `taxonomy segment "${segment}" begins with '--'`;
    if (segment.includes(">")) return `taxonomy segment "${segment}" contains '>'`;
  }
  for (const tag of classification.tags) {
    if (!isSafeArgValue(tag)) return `tag "${tag}" begins with '--'`;
    if (tag.includes(",")) return `tag "${tag}" contains ','`;
  }
  return null;
}

/**
 * Inserts exactly one accepted candidate via the repository's official
 * scripts/add-source.js CLI (never by writing sources.json directly),
 * invoked with execFile + an argv array so no shell ever interprets the
 * AI-produced title/description/tags. Verifies the entry actually landed
 * in sources.json afterward before reporting success.
 */
export async function insertSource(
  candidate: Candidate,
  classification: Classification,
  dryRun: boolean,
): Promise<InsertionResult> {
  const unsafeReason = validateClassificationForInsertion(classification);
  if (unsafeReason) {
    return {
      candidate,
      classification,
      succeeded: false,
      sourceId: null,
      error: `Refused to insert: ${unsafeReason}`,
    };
  }

  if (dryRun) {
    return { candidate, classification, succeeded: true, sourceId: null, error: null };
  }

  const args = [
    ADD_SOURCE_SCRIPT,
    "--url",
    classification.canonicalUrl,
    "--path",
    classification.taxonomyPath.join(">"),
    "--tags",
    classification.tags.join(","),
    "--title",
    classification.title,
    "--description",
    classification.description,
  ];

  try {
    await execFileAsync(process.execPath, args, { cwd: repoRoot });
  } catch (error) {
    return {
      candidate,
      classification,
      succeeded: false,
      sourceId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const data = loadSources();
  const inserted = data.sources.find(
    (s) => normalizeSourceUrl(s.url) === normalizeSourceUrl(classification.canonicalUrl),
  );
  if (!inserted) {
    return {
      candidate,
      classification,
      succeeded: false,
      sourceId: null,
      error: "add-source.js exited successfully but the entry was not found in sources.json afterward",
    };
  }

  return { candidate, classification, succeeded: true, sourceId: inserted.id, error: null };
}
