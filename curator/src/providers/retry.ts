export class ProviderTimeoutError extends Error {
  constructor(ms: number) {
    super(`Provider request timed out after ${ms}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderRateLimitError extends Error {
  constructor(message = "Provider rate limit exceeded") {
    super(message);
    this.name = "ProviderRateLimitError";
  }
}

export interface RetryOptions {
  maxRetries: number;
  timeoutMs: number;
  baseDelayMs?: number;
}

export interface RetryOutcome<T> {
  result: T;
  attempts: number;
  latencyMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderTimeoutError) return true;
  if (error instanceof ProviderRateLimitError) return true;
  const status = statusOf(error);
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  return false;
}

/**
 * Runs `fn` with a bounded timeout (via AbortSignal) and exponential
 * backoff + jitter on retryable failures (timeouts, 429, 5xx). Non-retryable
 * errors (4xx auth/validation) propagate immediately on first attempt.
 */
export async function withRetryAndTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const baseDelayMs = options.baseDelayMs ?? 500;
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new ProviderTimeoutError(options.timeoutMs));
    }, options.timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return { result, attempts: attempt, latencyMs: Date.now() - start };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (!isRetryable(error) || attempt > options.maxRetries) {
        break;
      }
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * baseDelayMs;
      await sleep(backoff + jitter);
    }
  }

  throw lastError;
}
