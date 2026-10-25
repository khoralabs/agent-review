import { afterEach, describe, expect, test } from "bun:test";
import { claudeCodeMiddleware } from "./adapters/claude-code.ts";
import {
  clearAdaptersForTests,
  ensureBuiltInAdapters,
  listProviderIds,
  OPENROUTER_DEFAULT_BASE_URL,
  registerBuiltInAdapters,
  resolveLanguageModel,
} from "./index.ts";

const PREV_GATEWAY = process.env.AI_GATEWAY_API_KEY;
const PREV_OPENROUTER = process.env.OPENROUTER_API_KEY;
const PREV_OPENAI = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (PREV_GATEWAY === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = PREV_GATEWAY;
  if (PREV_OPENROUTER === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = PREV_OPENROUTER;
  if (PREV_OPENAI === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = PREV_OPENAI;
  clearAdaptersForTests();
  registerBuiltInAdapters();
});

describe("llm registry", () => {
  test("lists built-in providers including openrouter", () => {
    ensureBuiltInAdapters();
    const ids = listProviderIds();
    expect(ids).toContain("gateway");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai-compatible");
    expect(ids).toContain("claude-code");
  });

  test("unknown provider throws with known list", () => {
    expect(() => resolveLanguageModel("m", { provider: "nope" })).toThrow(/Unknown llm provider/);
  });

  test("ensureBuiltInAdapters recovers after clear", () => {
    clearAdaptersForTests();
    expect(listProviderIds()).toEqual([]);
    ensureBuiltInAdapters();
    expect(listProviderIds()).toContain("gateway");
  });
});

describe("gateway adapter", () => {
  test("requires AI_GATEWAY_API_KEY", () => {
    delete process.env.AI_GATEWAY_API_KEY;
    expect(() => resolveLanguageModel("google/x", { provider: "gateway" })).toThrow(
      /AI_GATEWAY_API_KEY/,
    );
  });

  test("returns trimmed model id string", () => {
    process.env.AI_GATEWAY_API_KEY = "gw-key";
    expect(resolveLanguageModel("  google/gemini  ", { provider: "gateway" })).toBe(
      "google/gemini",
    );
  });

  test("rejects baseURL and headers", () => {
    process.env.AI_GATEWAY_API_KEY = "gw-key";
    expect(() =>
      resolveLanguageModel("google/x", { provider: "gateway", baseURL: "https://example.com" }),
    ).toThrow(/baseURL/);
    expect(() =>
      resolveLanguageModel("google/x", {
        provider: "gateway",
        headers: { "X-Title": "x" },
      }),
    ).toThrow(/headers/);
  });
});

describe("openrouter adapter", () => {
  test("requires OPENROUTER_API_KEY", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => resolveLanguageModel("google/x", { provider: "openrouter" })).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  test("creates a language model with default base URL constant", () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const model = resolveLanguageModel("google/gemini-2.5-flash", { provider: "openrouter" });
    expect(model).not.toBeTypeOf("string");
    expect(OPENROUTER_DEFAULT_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });
});

describe("openai-compatible adapter", () => {
  test("requires baseURL", () => {
    process.env.OPENAI_API_KEY = "k";
    expect(() => resolveLanguageModel("gpt-4o", { provider: "openai-compatible" })).toThrow(
      /baseURL/,
    );
  });
});

describe("claude-code adapter", () => {
  test("creates a model from an alias or an anthropic/ id", () => {
    const alias = resolveLanguageModel(" sonnet ", { provider: "claude-code", effort: "high" });
    expect(alias).toMatchObject({ provider: "claude-code", modelId: "sonnet" });
    expect(resolveLanguageModel("anthropic/opus", { provider: "claude-code" })).toMatchObject({
      modelId: "opus",
    });
  });

  test("rejects non-Claude model ids", () => {
    expect(() =>
      resolveLanguageModel("google/gemini-3.8-flash", { provider: "claude-code" }),
    ).toThrow(/needs a Claude model/);
  });

  test("rejects baseURL and headers", () => {
    expect(() =>
      resolveLanguageModel("sonnet", { provider: "claude-code", baseURL: "https://example.com" }),
    ).toThrow(/baseURL/);
  });
});

describe("claude-code middleware", () => {
  const union = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    oneOf: [{ type: "object" as const, properties: { verdict: { const: "ignore" } } }],
  };

  async function generate(schema: object, reply: string) {
    const { transformParams, wrapGenerate } = claudeCodeMiddleware;
    if (transformParams === undefined || wrapGenerate === undefined) {
      throw new Error("middleware hooks missing");
    }
    const params = await transformParams({
      type: "generate",
      params: {
        prompt: [],
        responseFormat: { type: "json", schema },
        maxOutputTokens: 4096,
        tools: [{ type: "function", name: "inspectBash", inputSchema: { type: "object" } }],
      },
      model: {} as never,
    });
    const result = await wrapGenerate({
      doGenerate: async () => ({ content: [{ type: "text", text: reply }] }) as never,
      doStream: async () => ({}) as never,
      params,
      model: {} as never,
    });
    return { params, sent: params.responseFormat, content: result.content };
  }

  test("nests a non-object schema under value and unwraps the reply", async () => {
    const { sent, content } = await generate(union, '{"value":{"verdict":"ignore"}}');
    expect(sent).toEqual({
      type: "json",
      schema: {
        type: "object",
        properties: { value: { oneOf: union.oneOf } },
        required: ["value"],
        additionalProperties: false,
      },
    });
    expect(content).toEqual([{ type: "text", text: '{"verdict":"ignore"}' }]);
  });

  test("drops AI SDK tools and maxOutputTokens", async () => {
    const { params } = await generate(union, '{"value":{}}');
    expect(params.tools).toBeUndefined();
    expect(params.maxOutputTokens).toBeUndefined();
  });

  test("leaves object schemas and their replies alone", async () => {
    const schema = {
      type: "object" as const,
      properties: { summary: { type: "string" as const } },
    };
    const { params, sent, content } = await generate(schema, '{"summary":"ok"}');
    expect(params.tools).toBeUndefined();
    expect(sent).toEqual({ type: "json", schema });
    expect(content).toEqual([{ type: "text", text: '{"summary":"ok"}' }]);
  });
});
