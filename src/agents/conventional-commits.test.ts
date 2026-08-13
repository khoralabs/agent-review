import { describe, expect, test } from "bun:test";

import {
  CONVENTIONAL_COMMITS_SPEC,
  defineAnalystAgent,
  defineCommitMessageAgent,
  defineReviewAgent,
} from "./index.ts";

describe("CONVENTIONAL_COMMITS_SPEC", () => {
  test("embeds Conventional Commits 1.0.0 as an inlined constant", async () => {
    expect(CONVENTIONAL_COMMITS_SPEC).toContain("Commits MUST be prefixed with a type");
    expect(CONVENTIONAL_COMMITS_SPEC).toContain("<type>[optional scope]: <description>");
    expect(CONVENTIONAL_COMMITS_SPEC).not.toContain("name: conventional-commits");
    const source = await Bun.file(new URL("./conventional-commits.ts", import.meta.url)).text();
    expect(source).not.toContain("readFileSync");
    expect(source).not.toContain("node:fs");
  });
});

describe("agent instructions include the spec", () => {
  test("review, analyst, and commit-message agents load the spec", async () => {
    const review = await defineReviewAgent();
    const analyst = await defineAnalystAgent();
    const commitMessage = await defineCommitMessageAgent();
    expect(review.staticHash.length).toBeGreaterThan(0);
    expect(analyst.staticHash.length).toBeGreaterThan(0);
    expect(commitMessage.staticHash.length).toBeGreaterThan(0);
    expect(review.staticHash).not.toBe(analyst.staticHash);
  });
});
