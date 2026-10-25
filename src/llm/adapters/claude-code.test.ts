import { expect, mock, test } from "bun:test";

const calls: { id: string; settings: Record<string, unknown> }[] = [];

mock.module("ai-sdk-provider-claude-code", () => ({
  claudeCode: (id: string, settings: Record<string, unknown>) => {
    calls.push({ id, settings });
    return {
      specificationVersion: "v3",
      provider: "claude-code",
      modelId: id,
      supportedUrls: {},
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
      }),
    };
  },
}));

const { claudeCodeAdapter } = await import("./claude-code.ts");

test("runs Claude Code read-only in the inspected checkout, off API and cloud billing", async () => {
  const model = claudeCodeAdapter.createModel({
    modelId: "sonnet",
    effort: "low",
    cwd: "/repo/wt-1",
  });
  if (typeof model === "string") throw new Error("expected a model instance");
  const before = calls.length;
  await model.doGenerate({ prompt: [] });
  await model.doGenerate({ prompt: [] });

  expect(calls.length - before).toBe(2);
  expect(calls.at(-1)).toMatchObject({
    id: "sonnet",
    settings: {
      cwd: "/repo/wt-1",
      effort: "low",
      tools: ["Read", "Grep", "Glob"],
      disallowedTools: ["Read(**/.env*)"],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      env: {
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: undefined,
        ANTHROPIC_BASE_URL: undefined,
        CLAUDE_CODE_USE_BEDROCK: undefined,
        CLAUDE_CODE_USE_VERTEX: undefined,
        CLAUDE_CODE_USE_FOUNDRY: undefined,
      },
    },
  });
  expect(Object.keys(calls.at(-1)?.settings.env ?? {})).toHaveLength(6);
});
