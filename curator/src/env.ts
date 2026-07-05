/**
 * Secret loading and provider-credential validation.
 *
 * This module is the ONLY place in the curator that reads API-key
 * environment variables. It never returns key material to callers that
 * would log or persist it — callers get booleans ("is this provider
 * usable?") plus sanitized diagnostics.
 */

export type ProviderName = "openai" | "deepseek" | "gemini" | "vertexGemini";

/** Exact env-var name each provider adapter reads its secret from. */
export const PROVIDER_ENV_VARS: Record<ProviderName, string> = {
  vertexGemini: "GEMINI_VERTEX_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export const ALL_PROVIDER_NAMES = Object.keys(
  PROVIDER_ENV_VARS,
) as ProviderName[];

/** Non-secret CI-tunable overrides. Everything else lives in config.ts. */
export const RUNTIME_ENV_VARS = {
  dryRun: "CURATOR_DRY_RUN",
  force: "CURATOR_FORCE",
} as const;

export interface ProviderCredentialStatus {
  provider: ProviderName;
  envVar: string;
  present: boolean;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

/** Returns the raw secret for a provider. Callers must not log this value. */
export function getProviderSecret(provider: ProviderName): string | undefined {
  return readEnv(PROVIDER_ENV_VARS[provider]);
}

export function getProviderCredentialStatus(
  provider: ProviderName,
): ProviderCredentialStatus {
  return {
    provider,
    envVar: PROVIDER_ENV_VARS[provider],
    present: getProviderSecret(provider) !== undefined,
  };
}

export function getAllCredentialStatuses(): ProviderCredentialStatus[] {
  return ALL_PROVIDER_NAMES.map(getProviderCredentialStatus);
}

export function readBooleanEnv(name: string): boolean | undefined {
  const raw = readEnv(name);
  if (raw === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export interface EnvValidationResult {
  ok: boolean;
  enabledProviders: ProviderName[];
  disabledProviders: { provider: ProviderName; envVar: string; reason: string }[];
  errors: string[];
  warnings: string[];
}

/**
 * Cross-checks the providers a run wants against what's actually available.
 * `wantedProviders` should already reflect config.ts's `providers.enabled` list.
 * Fails closed: if none of the wanted providers have credentials, ok=false.
 */
export function validateProviderEnv(
  wantedProviders: ProviderName[],
): EnvValidationResult {
  const enabledProviders: ProviderName[] = [];
  const disabledProviders: EnvValidationResult["disabledProviders"] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const provider of wantedProviders) {
    const status = getProviderCredentialStatus(provider);
    if (status.present) {
      enabledProviders.push(provider);
    } else {
      disabledProviders.push({
        provider,
        envVar: status.envVar,
        reason: `${status.envVar} is not set`,
      });
      warnings.push(
        `Provider "${provider}" disabled: ${status.envVar} is not set.`,
      );
    }
  }

  if (enabledProviders.length === 0) {
    errors.push(
      "No enabled AI provider has valid credentials. Set at least one of: " +
        wantedProviders.map((p) => PROVIDER_ENV_VARS[p]).join(", "),
    );
  }

  return {
    ok: errors.length === 0,
    enabledProviders,
    disabledProviders,
    errors,
    warnings,
  };
}

/** Masks a secret for any diagnostic string that might reach a report/log. */
export function redactSecret(value: string | undefined): string {
  if (!value) return "(unset)";
  return "•".repeat(6);
}
