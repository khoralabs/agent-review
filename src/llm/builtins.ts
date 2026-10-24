import { anthropicAdapter } from "./adapters/anthropic.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
import { gatewayAdapter } from "./adapters/gateway.ts";
import { openaiAdapter } from "./adapters/openai.ts";
import { openaiCompatibleAdapter } from "./adapters/openai-compatible.ts";
import { openrouterAdapter } from "./adapters/openrouter.ts";
import { listProviderIds, registerAdapter } from "./registry.ts";

/** Register built-in adapters (safe to call repeatedly). */
export function registerBuiltInAdapters(): void {
  registerAdapter(gatewayAdapter);
  registerAdapter(openrouterAdapter);
  registerAdapter(openaiAdapter);
  registerAdapter(anthropicAdapter);
  registerAdapter(openaiCompatibleAdapter);
  registerAdapter(claudeCodeAdapter);
}

/** Ensure built-ins exist after clearAdaptersForTests or cold import of resolve. */
export function ensureBuiltInAdapters(): void {
  if (!listProviderIds().includes("gateway")) {
    registerBuiltInAdapters();
  }
}
