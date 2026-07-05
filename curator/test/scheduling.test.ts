import { describe, expect, it } from "vitest";
import { evaluateSchedulingGate, getLocalHour } from "../src/scheduling.js";
import { loadConfig } from "../src/config.js";

describe("scheduling gate", () => {
  it("computes the local hour for a given IANA timezone", () => {
    const utcNoon = new Date("2026-07-05T12:00:00Z");
    expect(getLocalHour("UTC", utcNoon)).toBe(12);
  });

  it("runs when forced, regardless of hour or last-run state", () => {
    const { config } = loadConfig({});
    const decision = evaluateSchedulingGate(config, true, new Date("2026-07-05T00:00:00Z"));
    expect(decision.shouldRun).toBe(true);
  });

  it("skips outside every configured local execution hour", () => {
    const base = loadConfig({}).config;
    const config = { ...base, scheduling: { ...base.scheduling, executionHours: [6], timezone: "UTC" } };
    const decision = evaluateSchedulingGate(config, false, new Date("2026-07-05T09:00:00Z"));
    expect(decision.shouldRun).toBe(false);
  });

  it("allows the run during any configured execution hour when no prior run blocks it", () => {
    const base = loadConfig({}).config;
    const config = { ...base, scheduling: { ...base.scheduling, executionHours: [9], timezone: "UTC" } };
    const decision = evaluateSchedulingGate(config, false, new Date("2026-07-05T09:00:00Z"));
    expect(decision.shouldRun).toBe(true);
  });

  it("supports multiple execution hours per day (e.g. 4 runs/day)", () => {
    const base = loadConfig({}).config;
    const config = { ...base, scheduling: { ...base.scheduling, executionHours: [0, 6, 12, 18], timezone: "UTC" } };
    for (const hour of [0, 6, 12, 18]) {
      const decision = evaluateSchedulingGate(config, false, new Date(`2026-07-05T${String(hour).padStart(2, "0")}:00:00Z`));
      expect(decision.shouldRun).toBe(true);
    }
    const offHour = evaluateSchedulingGate(config, false, new Date("2026-07-05T03:00:00Z"));
    expect(offHour.shouldRun).toBe(false);
  });
});
