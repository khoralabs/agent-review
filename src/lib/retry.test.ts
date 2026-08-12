import { describe, expect, test } from "bun:test";

import { isRateLimitError, withRetry } from "./retry.ts";

describe("withRetry", () => {
  test("retries rate-limit errors with backoff then succeeds", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          const err = new Error("rate limit exceeded");
          (err as Error & { statusCode: number }).statusCode = 429;
          throw err;
        }
        return "ok";
      },
      {
        maxAttempts: 4,
        baseDelayMs: 10,
        maxDelayMs: 40,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(delays.length).toBe(2);
  });

  test("does not retry non-rate-limit errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("permanent failure");
        },
        { maxAttempts: 4, sleep: async () => {} },
      ),
    ).rejects.toThrow("permanent failure");
    expect(attempts).toBe(1);
  });

  test("isRateLimitError detects 429 statusCode", () => {
    const err = new Error("too many requests");
    (err as Error & { statusCode: number }).statusCode = 429;
    expect(isRateLimitError(err)).toBe(true);
    expect(isRateLimitError(new Error("boom"))).toBe(false);
  });
});
