import { describe, expect, test } from "bun:test";

import { analystLlmOutputSchema } from "./analyst.ts";

describe("analystLlmOutputSchema", () => {
  test("parses ignore", () => {
    const parsed = analystLlmOutputSchema.parse({
      verdict: "ignore",
      rationale: "style nit only",
    });
    expect(parsed).toEqual({
      verdict: "ignore",
      rationale: "style nit only",
    });
  });

  test("parses lean remediate", () => {
    const parsed = analystLlmOutputSchema.parse({
      verdict: "remediate",
      task: "Sanitize work-log paths",
      rationale: "path traversal risk for downstream tools",
      steps: ["reject absolute paths", "reject .. segments", "add unit tests"],
    });
    expect(parsed.verdict).toBe("remediate");
    if (parsed.verdict !== "remediate") throw new Error("expected remediate");
    expect(parsed.task).toBe("Sanitize work-log paths");
    expect(parsed.steps).toHaveLength(3);
  });

  test("rejects remediate without steps", () => {
    expect(() =>
      analystLlmOutputSchema.parse({
        verdict: "remediate",
        task: "Fix it",
        rationale: "bug",
      }),
    ).toThrow();
  });
});
