import fs from "node:fs";
import path from "node:path";
import type { ProviderName } from "../env.js";
import type { ScoreRefreshResult } from "../insertion/score-refresh.js";
import type { PullRequestResult, CommitResult, DispatchWorkflowResult } from "../git/branch.js";

export interface RunReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  status: "success" | "partial" | "failed" | "skipped";
  configFingerprint: string;
  activeProviders: ProviderName[];
  disabledProviders: { provider: ProviderName; envVar: string; reason: string }[];
  searchQueries: string[];
  discoveryMethods: string[];
  counts: {
    discovered: number;
    mechanicallyRejected: number;
    sentToAiReview: number;
    accepted: number;
    rejected: number;
    deferred: number;
  };
  acceptedSourceUrls: string[];
  finalTaxonomyPaths: string[][];
  finalTags: string[];
  rejectionReasonCounts: Record<string, number>;
  duplicateMatches: { candidateUrl: string; existingSourceId: string; matchType: string }[];
  providerDisagreements: { candidateUrl: string; disagreements: string[] }[];
  providerFailures: { candidateUrl: string; provider: ProviderName; error: string }[];
  retryCounts: Record<string, number>;
  filesChanged: string[];
  commandsExecuted: string[];
  scoreRefresh: ScoreRefreshResult | null;
  validation: { readmeGenerated: boolean; sourcesJsonValid: boolean; errors: string[] };
  build: { ran: boolean; succeeded: boolean; error: string | null };
  output: {
    mode: "report-only" | "commit" | "pull-request" | "dry-run";
    commit: CommitResult | null;
    pullRequest: PullRequestResult | null;
    /** Only set for commitMode "commit", and only after a real push succeeded. */
    pagesDeployDispatch: DispatchWorkflowResult | null;
  };
  notes: string[];
}

function stableRunId(startedAt: Date): string {
  return startedAt.toISOString().slice(0, 10); // one report per calendar day (UTC)
}

export function createRunId(startedAt: Date): string {
  return stableRunId(startedAt);
}

/** Sorts everything that has no meaningful order so the JSON diffs cleanly run-to-run. */
export function finalizeReportForWrite(report: RunReport): RunReport {
  return {
    ...report,
    acceptedSourceUrls: [...report.acceptedSourceUrls].sort(),
    finalTags: [...report.finalTags].sort(),
    filesChanged: [...report.filesChanged].sort(),
    rejectionReasonCounts: Object.fromEntries(
      Object.entries(report.rejectionReasonCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    retryCounts: Object.fromEntries(
      Object.entries(report.retryCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function writeReport(report: RunReport, reportDir: string, repoRoot: string): string {
  const absoluteDir = path.isAbsolute(reportDir) ? reportDir : path.join(repoRoot, reportDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  const filePath = path.join(absoluteDir, `run-${report.runId}.json`);
  const finalized = finalizeReportForWrite(report);
  fs.writeFileSync(filePath, `${JSON.stringify(finalized, null, 2)}\n`);
  return filePath;
}
