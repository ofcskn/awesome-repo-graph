import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CuratorConfig } from "./config.js";

const curatorSrcDir = fileURLToPath(new URL(".", import.meta.url));
export const LAST_RUN_STATE_PATH = path.resolve(curatorSrcDir, "..", "state", "last-run.json");

export interface LastRunState {
  lastSuccessAt: string | null;
}

export function loadLastRunState(): LastRunState {
  if (!fs.existsSync(LAST_RUN_STATE_PATH)) return { lastSuccessAt: null };
  try {
    const raw = fs.readFileSync(LAST_RUN_STATE_PATH, "utf8");
    const data = JSON.parse(raw) as Partial<LastRunState>;
    return { lastSuccessAt: data.lastSuccessAt ?? null };
  } catch {
    return { lastSuccessAt: null };
  }
}

export function saveLastRunState(state: LastRunState): void {
  fs.mkdirSync(path.dirname(LAST_RUN_STATE_PATH), { recursive: true });
  fs.writeFileSync(LAST_RUN_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

/** Returns the current hour (0-23) local to `timezone`, using the platform's IANA tz database. */
export function getLocalHour(timezone: string, now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const hourPart = formatter.formatToParts(now).find((part) => part.type === "hour")?.value ?? "0";
  // Intl can format midnight as "24" in some environments; normalize to 0-23.
  return Number(hourPart) % 24;
}

export interface SchedulingDecision {
  shouldRun: boolean;
  reason: string;
}

/**
 * Gate used by the scheduled (workflow_dispatch/cron) entry point only —
 * manual `curate` CLI runs bypass this entirely. The GitHub Actions cron
 * fires hourly; this gate only lets the run proceed when the current local
 * hour is one of config.scheduling.executionHours (supports multiple runs
 * per day), and enforces at least config.scheduling.minIntervalHoursBetweenRuns
 * between successful runs, unless `force` is set (workflow_dispatch "force" input).
 */
export function evaluateSchedulingGate(
  config: CuratorConfig,
  force: boolean,
  now: Date = new Date(),
): SchedulingDecision {
  if (force) {
    return { shouldRun: true, reason: "forced via CURATOR_FORCE / --force" };
  }

  const localHour = getLocalHour(config.scheduling.timezone, now);
  if (!config.scheduling.executionHours.includes(localHour)) {
    return {
      shouldRun: false,
      reason: `current local hour ${localHour} (in ${config.scheduling.timezone}) is not one of the configured execution hours [${config.scheduling.executionHours.join(", ")}]`,
    };
  }

  const { lastSuccessAt } = loadLastRunState();
  if (lastSuccessAt) {
    const hoursSinceLastRun = (now.getTime() - new Date(lastSuccessAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastRun < config.scheduling.minIntervalHoursBetweenRuns) {
      return {
        shouldRun: false,
        reason: `last successful run was ${hoursSinceLastRun.toFixed(1)}h ago, below the configured ${config.scheduling.minIntervalHoursBetweenRuns}h minimum interval`,
      };
    }
  }

  return { shouldRun: true, reason: "within configured daily execution window" };
}
