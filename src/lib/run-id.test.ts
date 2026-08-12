import { describe, expect, test } from "bun:test";

import {
  formatReviewRunId,
  resolveReviewedShortSha,
  resolveReviewGitRefs,
  reviewedRevForScope,
} from "./run-id.ts";

describe("formatReviewRunId", () => {
  test("formats UTC datetime and short sha", () => {
    const date = new Date(Date.UTC(2026, 7, 11, 19, 47, 12));
    expect(formatReviewRunId(date, "a1b2c3d")).toBe("20260811T194712Z-a1b2c3d");
  });

  test("sanitizes empty/unsafe sha tokens", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(formatReviewRunId(date, "")).toBe("20260101T000000Z-unknown");
    expect(formatReviewRunId(date, "abc/def")).toBe("20260101T000000Z-abc-def");
  });
});

describe("reviewedRevForScope", () => {
  test("commit uses commit or HEAD", () => {
    expect(reviewedRevForScope({ scope: "commit", commit: "abc" })).toBe("abc");
    expect(reviewedRevForScope({ scope: "commit" })).toBe("HEAD");
  });

  test("range uses head or HEAD", () => {
    expect(reviewedRevForScope({ scope: "range", head: "feature" })).toBe("feature");
    expect(reviewedRevForScope({ scope: "range" })).toBe("HEAD");
  });

  test("staged/working/stdin use HEAD", () => {
    expect(reviewedRevForScope({ scope: "staged" })).toBe("HEAD");
    expect(reviewedRevForScope({ scope: "working" })).toBe("HEAD");
    expect(reviewedRevForScope({ scope: "stdin" })).toBe("HEAD");
  });
});

describe("resolveReviewedShortSha", () => {
  test("returns parsed short sha", async () => {
    const short = await resolveReviewedShortSha({
      cwd: "/tmp",
      scope: "staged",
      revParseFn: async () => "deadbee",
    });
    expect(short).toBe("deadbee");
  });

  test("falls back to unknown when rev-parse fails", async () => {
    const short = await resolveReviewedShortSha({
      cwd: "/tmp",
      scope: "commit",
      commit: "HEAD",
      revParseFn: async () => undefined,
    });
    expect(short).toBe("unknown");
  });

  test("falls back to stdin for stdin scope when rev-parse fails", async () => {
    const short = await resolveReviewedShortSha({
      cwd: "/tmp",
      scope: "stdin",
      revParseFn: async () => undefined,
    });
    expect(short).toBe("stdin");
  });

  test("range resolves head rev", async () => {
    let seen: string | undefined;
    await resolveReviewedShortSha({
      cwd: "/repo",
      scope: "range",
      base: "main",
      head: "feature",
      revParseFn: async (rev) => {
        seen = rev;
        return "f00bar1";
      },
    });
    expect(seen).toBe("feature");
  });
});

describe("resolveReviewGitRefs", () => {
  test("resolves gitHead for staged and range base/head", async () => {
    const shas: Record<string, string> = {
      HEAD: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      main: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      feature: "cccccccccccccccccccccccccccccccccccccccc",
    };
    const staged = await resolveReviewGitRefs({
      cwd: "/repo",
      scope: "staged",
      revParseFn: async (rev) => shas[rev],
    });
    expect(staged).toEqual({
      gitHead: shas.HEAD,
    });

    const range = await resolveReviewGitRefs({
      cwd: "/repo",
      scope: "range",
      base: "main",
      head: "feature",
      revParseFn: async (rev) => shas[rev],
    });
    expect(range).toEqual({
      gitHead: shas.HEAD,
      base: shas.main,
      head: shas.feature,
    });
  });

  test("resolves commit scope full SHA", async () => {
    const commit = await resolveReviewGitRefs({
      cwd: "/repo",
      scope: "commit",
      commit: "abc123",
      revParseFn: async (rev) =>
        rev === "HEAD"
          ? "dddddddddddddddddddddddddddddddddddddddd"
          : "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    expect(commit.gitHead).toBe("dddddddddddddddddddddddddddddddddddddddd");
    expect(commit.commit).toBe("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  });
});
