import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALL_PROVIDER_NAMES,
  getProviderCredentialStatus,
  PROVIDER_ENV_VARS,
  redactSecret,
  validateProviderEnv,
} from "../src/env.js";
import { loadConfig } from "../src/config.js";

const ENV_KEYS = Object.values(PROVIDER_ENV_VARS);

function clearProviderEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("env/config synchronization", () => {
  beforeEach(clearProviderEnv);
  afterEach(clearProviderEnv);

  it("maps each provider to its exact spec-required env var", () => {
    expect(PROVIDER_ENV_VARS.vertexGemini).toBe("GEMINI_VERTEX_API_KEY");
    expect(PROVIDER_ENV_VARS.deepseek).toBe("DEEPSEEK_API_KEY");
    expect(PROVIDER_ENV_VARS.openai).toBe("OPENAI_API_KEY");
    expect(PROVIDER_ENV_VARS.gemini).toBe("GEMINI_API_KEY");
  });

  it("fails validation when no provider has credentials (missing-secret behavior)", () => {
    const result = validateProviderEnv(ALL_PROVIDER_NAMES);
    expect(result.ok).toBe(false);
    expect(result.enabledProviders).toHaveLength(0);
    expect(result.disabledProviders).toHaveLength(4);
  });

  it("activates only providers with a present env var (provider activation)", () => {
    process.env.OPENAI_API_KEY = "sk-test-key-123456";
    const result = validateProviderEnv(ALL_PROVIDER_NAMES);
    expect(result.ok).toBe(true);
    expect(result.enabledProviders).toEqual(["openai"]);
    expect(getProviderCredentialStatus("gemini").present).toBe(false);
  });

  it("keeps config.ts internally consistent (primary must be in enabled, every provider has a model)", () => {
    const { config } = loadConfig({});
    expect(config.providers.enabled).toContain(config.providers.primary);
    for (const provider of ALL_PROVIDER_NAMES) {
      expect(config.providers.models[provider]).toBeTruthy();
    }
  });

  it("applies CLI/env dry-run and force overrides on top of config.ts defaults", () => {
    const { dryRun, force } = loadConfig({ dryRun: true, force: true });
    expect(dryRun).toBe(true);
    expect(force).toBe(true);
  });

  it("falls back to config.ts's default when no override is given", () => {
    const { dryRun } = loadConfig({});
    expect(dryRun).toBe(false);
  });
});

describe("secret redaction", () => {
  it("never includes the original secret value", () => {
    const masked = redactSecret("sk-abcdef123456");
    expect(masked).not.toContain("abcdef123456");
  });

  it("reports unset secrets distinctly from masked ones", () => {
    expect(redactSecret(undefined)).toBe("(unset)");
  });
});
