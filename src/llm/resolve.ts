import type { LanguageModel } from "ai";
import { ensureBuiltInAdapters } from "./builtins.ts";
import { getAdapter } from "./registry.ts";
import { DEFAULT_LLM_CONFIG, type LlmConfig, type LlmProviderContext } from "./types.ts";

export function resolveLanguageModel(
  modelId: string,
  llm: LlmConfig = DEFAULT_LLM_CONFIG,
  cwd?: string,
): LanguageModel {
  ensureBuiltInAdapters();
  const adapter = getAdapter(llm.provider);
  const ctx: LlmProviderContext = {
    modelId,
    ...(llm.apiKeyEnv !== undefined && llm.apiKeyEnv !== null ? { apiKeyEnv: llm.apiKeyEnv } : {}),
    ...(llm.baseURL !== undefined && llm.baseURL !== null ? { baseURL: llm.baseURL } : {}),
    ...(llm.headers !== undefined && llm.headers !== null ? { headers: llm.headers } : {}),
    ...(llm.effort !== undefined ? { effort: llm.effort } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
  };
  return adapter.createModel(ctx);
}
