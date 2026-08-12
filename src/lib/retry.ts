export type WithRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

function defaultIsRetryable(err: unknown): boolean {
  if (err === null || typeof err !== "object") {
    return typeof err === "string" && /429|rate.?limit/i.test(err);
  }
  const record = err as Record<string, unknown>;
  const status = record.statusCode ?? record.status ?? record.code ?? record.statusText;
  if (status === 429 || status === "429" || status === "RATE_LIMIT") return true;
  const message =
    err instanceof Error ? err.message : typeof record.message === "string" ? record.message : "";
  return /429|rate.?limit|too many requests/i.test(message);
}

/**
 * Retry `fn` with exponential backoff + jitter for rate-limit style failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const exp = baseDelayMs * 2 ** (attempt - 1);
      const capped = Math.min(maxDelayMs, exp);
      const jitter = Math.floor(Math.random() * capped * 0.25);
      await sleep(capped + jitter);
    }
  }
  throw lastError;
}

export { defaultIsRetryable as isRateLimitError };
