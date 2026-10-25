import { createRequire } from "node:module";
import {
  type JSONSchema7,
  type LanguageModel,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from "ai";
import type { LlmProviderAdapter, LlmProviderContext } from "../types.ts";

type ClaudeCodeModule = typeof import("ai-sdk-provider-claude-code");

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

const BILLING_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

const TOOL_NOTE =
  "inspectBash is not available in this session. Use the Read, Grep, and Glob tools to inspect code instead.";

/** The provider warns on every built-in tool result it did not see requested; that is noise here. */
const quietLogger = {
  debug: () => {},
  info: () => {},
  warn: (message: string) => {
    if (!message.includes("unknown tool ID")) console.warn(message);
  },
  error: (message: string) => console.error(message),
};

const wrappedSchemas = new WeakSet<JSONSchema7>();

function unwrapValue(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text).value);
  } catch {
    return text;
  }
}

/**
 * Claude Code runs its own tools and has no output token cap, so drop those
 * params instead of letting the provider warn on every call. It also sends the
 * output schema as a tool input_schema, which the API requires to be
 * `type: "object"`: nest other schemas (e.g. a top-level oneOf) under `value`
 * and unwrap the reply.
 */
export const claudeCodeMiddleware: LanguageModelMiddleware = {
  async transformParams({
    params: {
      tools: _tools,
      toolChoice: _toolChoice,
      maxOutputTokens: _maxOutputTokens,
      ...params
    },
  }) {
    const format = params.responseFormat;
    if (format?.type !== "json" || format.schema === undefined || format.schema.type === "object") {
      return params;
    }
    const { $schema: _schemaUri, $defs, definitions, ...value } = format.schema;
    const schema: JSONSchema7 = {
      type: "object",
      properties: { value },
      required: ["value"],
      additionalProperties: false,
      ...($defs !== undefined ? { $defs } : {}),
      ...(definitions !== undefined ? { definitions } : {}),
    };
    wrappedSchemas.add(schema);
    return { ...params, responseFormat: { ...format, schema } };
  },
  async wrapGenerate({ doGenerate, params }) {
    const result = await doGenerate();
    const format = params.responseFormat;
    if (
      format?.type !== "json" ||
      format.schema === undefined ||
      !wrappedSchemas.has(format.schema)
    ) {
      return result;
    }
    return {
      ...result,
      content: result.content.map((part) =>
        part.type === "text" ? { ...part, text: unwrapValue(part.text) } : part,
      ),
    };
  },
};

/** Optional peer: the Agent SDK ships a large native binary, so load it only for this provider. */
function loadClaudeCode(): ClaudeCodeModule {
  try {
    return createRequire(import.meta.url)("ai-sdk-provider-claude-code");
  } catch (cause) {
    throw new Error(
      "claude-code provider requires the ai-sdk-provider-claude-code package; install it next to @khoralabs/agent-review",
      { cause },
    );
  }
}

/** Claude Code takes aliases (sonnet, opus) or full ids; accept the Gateway-style anthropic/ prefix. */
function claudeModelId(modelId: string): string {
  const id = modelId.trim().replace(/^anthropic\//, "");
  if (id.length === 0) throw new Error("model is required");
  if (id.includes("/")) {
    throw new Error(
      `claude-code provider needs a Claude model (e.g. sonnet, opus, haiku); got "${modelId.trim()}"`,
    );
  }
  return id;
}

export const claudeCodeAdapter: LlmProviderAdapter = {
  id: "claude-code",
  label: "Claude Code (subscription login)",
  defaultApiKeyEnv: "CLAUDE_CODE_OAUTH_TOKEN",
  createModel(ctx: LlmProviderContext): LanguageModel {
    const id = claudeModelId(ctx.modelId);
    if (ctx.baseURL !== undefined || ctx.headers !== undefined || ctx.apiKeyEnv !== undefined) {
      throw new Error(
        "claude-code provider does not support llm.baseURL, llm.headers, or llm.apiKeyEnv",
      );
    }
    const { claudeCode } = loadClaudeCode();
    const fresh = () =>
      claudeCode(id, {
        ...(ctx.effort !== undefined ? { effort: ctx.effort } : {}),
        ...(ctx.cwd !== undefined ? { cwd: ctx.cwd } : {}),
        tools: READ_ONLY_TOOLS,
        disallowedTools: ["Read(**/.env*)"],
        systemPrompt: TOOL_NOTE,
        logger: quietLogger,
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        // Keep billing on the logged-in subscription (or CLAUDE_CODE_OAUTH_TOKEN), never an API key or cloud account.
        env: Object.fromEntries(BILLING_ENV.map((key) => [key, undefined])),
      });
    // A provider model resumes its previous session on the next call; each agent call must start clean.
    const { specificationVersion, provider, modelId, supportedUrls } = fresh();
    const model: Pick<
      ReturnType<typeof fresh>,
      "specificationVersion" | "provider" | "modelId" | "supportedUrls" | "doGenerate" | "doStream"
    > = {
      specificationVersion,
      provider,
      modelId,
      supportedUrls,
      doGenerate: (options) => fresh().doGenerate(options),
      doStream: (options) => fresh().doStream(options),
    };
    // Cast: nested @ai-sdk/provider copies under ai vs ai-sdk-provider-claude-code disagree at typecheck.
    return wrapLanguageModel({
      model: model as Exclude<LanguageModel, string>,
      middleware: claudeCodeMiddleware,
    });
  },
};
