import type { LanguageModel } from "ai";

export const LLM_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/** Reasoning effort; only adapters that support it (claude-code) use it. */
export type LlmEffort = (typeof LLM_EFFORT_LEVELS)[number];

/** Context passed to a provider adapter when building a LanguageModel. */
export type LlmProviderContext = {
  modelId: string;
  /** Env var name for the API key; adapter default if omitted. */
  apiKeyEnv?: string;
  baseURL?: string;
  /** Extra HTTP headers (e.g. OpenRouter HTTP-Referer / X-Title). */
  headers?: Record<string, string>;
  effort?: LlmEffort;
  /** Checkout the agent inspects; adapters whose tools read files directly (claude-code) run there. */
  cwd?: string;
};

/** Runtime adapter: one module per LLM token API. */
export type LlmProviderAdapter = {
  id: string;
  label: string;
  defaultApiKeyEnv: string;
  createModel(ctx: LlmProviderContext): LanguageModel;
};

/** Config slice for selecting and tuning a provider. */
export type LlmConfig = {
  provider: string;
  apiKeyEnv?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  effort?: LlmEffort;
};

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: "gateway",
};
