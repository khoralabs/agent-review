import { describe, expect, test } from "bun:test";

import { mapPool } from "./pool.ts";

describe("mapPool", () => {
  test("preserves order and respects concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: number[] = [];

    const results = await mapPool([10, 20, 30, 40], 2, async (item, index) => {
      started.push(index);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(30);
      inFlight -= 1;
      return item + 1;
    });

    expect(results).toEqual([11, 21, 31, 41]);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  test("clamps concurrency to item count", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    await mapPool(["a", "b"], 8, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(10);
      inFlight -= 1;
      return item;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  test("processes undefined elements without aborting workers", async () => {
    const items: Array<number | undefined> = [1, undefined, 3, undefined, 5];
    const seen: number[] = [];
    const results = await mapPool(items, 2, async (item, index) => {
      seen.push(index);
      await Bun.sleep(5);
      return item ?? -1;
    });
    expect(results).toEqual([1, -1, 3, -1, 5]);
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  test("falls back when concurrency is NaN", async () => {
    const results = await mapPool([1, 2, 3], Number.NaN, async (item) => {
      await Bun.sleep(5);
      return item * 2;
    });
    expect(results).toEqual([2, 4, 6]);
  });

  test("stops scheduling after a task failure and propagates the error", async () => {
    const started: number[] = [];
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await expect(
        mapPool([0, 1, 2, 3, 4, 5], 2, async (item) => {
          started.push(item);
          await Bun.sleep(10);
          if (item === 1) throw new Error("boom");
          return item;
        }),
      ).rejects.toThrow("boom");

      await Bun.sleep(50);
      expect(unhandled).toBe(0);
      expect(started.length).toBeLessThan(6);
      expect(started).toContain(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
