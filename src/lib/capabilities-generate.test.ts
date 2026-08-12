import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { stripMarkdownJsonFence, tryRecoverStructuredOutput } from "./capabilities-generate.ts";

const schema = z.object({
  verdict: z.literal("ignore"),
  rationale: z.string().min(1),
});

describe("stripMarkdownJsonFence", () => {
  test("returns trimmed raw JSON unchanged", () => {
    expect(stripMarkdownJsonFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  test("strips json fences", () => {
    expect(stripMarkdownJsonFence('```json\n{"verdict":"ignore"}\n```')).toBe(
      '{"verdict":"ignore"}',
    );
  });

  test("strips bare fences", () => {
    expect(stripMarkdownJsonFence("```\n{}\n```")).toBe("{}");
  });
});

describe("tryRecoverStructuredOutput", () => {
  test("recovers direct JSON text", () => {
    const recovered = tryRecoverStructuredOutput(
      {
        text: JSON.stringify({
          verdict: "ignore",
          rationale: "style only",
        }),
      },
      schema,
    );
    expect(recovered).toEqual({
      verdict: "ignore",
      rationale: "style only",
    });
  });

  test("recovers markdown-fenced JSON text", () => {
    const recovered = tryRecoverStructuredOutput(
      {
        text: '```json\n{"verdict":"ignore","rationale":"nit"}\n```',
      },
      schema,
    );
    expect(recovered).toEqual({
      verdict: "ignore",
      rationale: "nit",
    });
  });

  test("returns undefined for unparsable text", () => {
    expect(tryRecoverStructuredOutput({ text: "not json at all" }, schema)).toBeUndefined();
  });
});
