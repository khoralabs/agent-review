import { describe, expect, test } from "bun:test";

import { formatWalkId, listCommitsInRange } from "./walk-commits.ts";

describe("listCommitsInRange", () => {
  test("exclusive from, inclusive to, oldest first", async () => {
    const commits = await listCommitsInRange({
      cwd: "/tmp",
      from: "aaaa",
      to: "dddd",
      revListFn: async (from, to) => {
        expect(from).toBe("aaaa");
        expect(to).toBe("dddd");
        return ["bbbb", "cccc", "dddd"];
      },
    });
    expect(commits).toEqual(["bbbb", "cccc", "dddd"]);
  });

  test("maxCommits truncates after rev-list", async () => {
    const commits = await listCommitsInRange({
      cwd: "/tmp",
      from: "a",
      to: "d",
      maxCommits: 2,
      revListFn: async () => ["b", "c", "d"],
    });
    expect(commits).toEqual(["b", "c"]);
  });

  test("requires --from", async () => {
    await expect(listCommitsInRange({ cwd: "/tmp", from: "  ", to: "HEAD" })).rejects.toThrow(
      "--from is required",
    );
  });
});

describe("formatWalkId", () => {
  test("sortable UTC id with from..to shorts", () => {
    const id = formatWalkId({
      date: new Date(Date.UTC(2026, 7, 12, 14, 30, 5)),
      fromShort: "abc1234",
      toShort: "def5678",
    });
    expect(id).toBe("20260812T143005Z-abc1234..def5678");
  });
});
