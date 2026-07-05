import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, RejectionRecord, RejectionReasonCode } from "../types.js";

const curatorSrcDir = fileURLToPath(new URL(".", import.meta.url));
export const REJECTION_STATE_PATH = path.resolve(curatorSrcDir, "..", "state", "rejected.json");

/** Rejection reasons that reflect a transient condition, not the project itself. */
const TRANSIENT_REASONS = new Set<RejectionReasonCode>([
  "provider-error",
  "url-unresolvable",
  "insertion-failed",
]);

export function isTransientRejection(reason: RejectionReasonCode): boolean {
  return TRANSIENT_REASONS.has(reason);
}

function stableHash(payload: string): string {
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

export function computeMetadataFingerprint(candidate: Candidate, configFingerprint: string): string {
  const payload = JSON.stringify({
    stars: candidate.stars,
    license: candidate.license,
    archived: candidate.archived,
    isFork: candidate.isFork,
    lastPushAt: candidate.lastPushAt,
    configFingerprint,
  });
  return `fp_${stableHash(payload)}`;
}

export function loadRejectionHistory(): RejectionRecord[] {
  if (!fs.existsSync(REJECTION_STATE_PATH)) return [];
  const raw = fs.readFileSync(REJECTION_STATE_PATH, "utf8");
  const data = JSON.parse(raw) as { rejections?: RejectionRecord[] };
  return Array.isArray(data.rejections) ? data.rejections : [];
}

export function saveRejectionHistory(records: RejectionRecord[]): void {
  fs.mkdirSync(path.dirname(REJECTION_STATE_PATH), { recursive: true });
  const sorted = [...records].sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
  fs.writeFileSync(REJECTION_STATE_PATH, `${JSON.stringify({ rejections: sorted }, null, 2)}\n`);
}

export function buildRejectionRecord(
  candidate: Candidate,
  reasonCode: RejectionReasonCode,
  configFingerprint: string,
  reconsiderAfterDays: number | null,
): RejectionRecord {
  const now = new Date();
  return {
    canonicalUrl: candidate.canonicalUrl,
    githubId: candidate.githubId,
    evaluatedAt: now.toISOString(),
    reasonCode,
    metadataFingerprint: computeMetadataFingerprint(candidate, configFingerprint),
    reconsiderAt:
      reconsiderAfterDays !== null
        ? new Date(now.getTime() + reconsiderAfterDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
  };
}

export function upsertRejection(
  history: RejectionRecord[],
  record: RejectionRecord,
): RejectionRecord[] {
  const filtered = history.filter((r) => r.canonicalUrl !== record.canonicalUrl);
  filtered.push(record);
  return filtered;
}

export interface ReconsiderationCheck {
  shouldSkip: boolean;
  reason: "not-previously-rejected" | "metadata-changed" | "reconsideration-date-reached" | "recently-evaluated";
}

/**
 * Implements the REJECTED-CANDIDATE MEMORY reconsideration rules: a
 * previously-rejected candidate is only skipped again when its metadata
 * fingerprint (stars/license/activity/fork/archive state) and the config
 * fingerprint are unchanged AND its reconsideration date (if any) hasn't
 * been reached AND it wasn't evaluated too long ago to still be "recent".
 */
export function checkReconsideration(
  history: RejectionRecord[],
  candidate: Candidate,
  configFingerprint: string,
  minReevaluationIntervalDays: number,
): ReconsiderationCheck {
  const record = history.find((r) => r.canonicalUrl === candidate.canonicalUrl);
  if (!record) {
    return { shouldSkip: false, reason: "not-previously-rejected" };
  }

  const currentFingerprint = computeMetadataFingerprint(candidate, configFingerprint);
  if (currentFingerprint !== record.metadataFingerprint) {
    return { shouldSkip: false, reason: "metadata-changed" };
  }

  if (record.reconsiderAt && new Date(record.reconsiderAt).getTime() <= Date.now()) {
    return { shouldSkip: false, reason: "reconsideration-date-reached" };
  }

  const ageDays = (Date.now() - new Date(record.evaluatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays >= minReevaluationIntervalDays) {
    return { shouldSkip: false, reason: "reconsideration-date-reached" };
  }

  return { shouldSkip: true, reason: "recently-evaluated" };
}
