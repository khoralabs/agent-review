# ADR 0008: Agent backend facade

## Status

Accepted

## Context

ADR 0006 abstracted **token APIs** (`LlmProviderAdapter` → `LanguageModel`).
Review, analyze, and commit-message still shared one hardcoded runtime:
capabilities agents + Vercel AI SDK `generateText` with structured output.

Operators want to run those same tasks through Cursor Agent, Claude Code,
Codex, or other CLIs without forking the pipeline. The missing layer is the
**agent runner**, not another token provider.

Forces:

- Keep the AI SDK + provider path as the zero-config default
- Prefer a small registry of backends over growing CLI switches
- One backend selection for all three LLM roles (v1)
- External agents bring their own tools; we only facilitate task + schema

## Decision

We will add `src/agent-backend/` with an `AgentBackend` registry and
`resolveAgentBackend(config)`. Built-ins:

- **`llm`** (default) — reference implementation: role agent defs +
  `resolveLanguageModel` + `capabilitiesGenerateText` (ADR 0006 providers)
- **`cli`** — generic subprocess: task bundle (system, prompt, JSON Schema) on
  stdin or `{{taskFile}}`, stdout JSON matching the schema

Config key `agent.backend` and CLI `--agent-backend` /
`AGENT_REVIEW_AGENT_BACKEND` select the runner. Existing `llm` / `model`
remain and apply when `backend` is `llm`.

## Consequences

### Positive

- Pipelines call one facade; swapping runners does not rewrite phases
- Cursor / Claude / Codex work via operator-owned `agent.cli` without
  first-party SDKs
- Token adapters stay an implementation detail of the `llm` backend

### Negative

- CLI backends synthesize capability hashes (no agent-capabilities snapshot)
- Concurrent analyst triage can spawn many subprocesses

### Neutral

- ADR 0006 remains valid for token provider selection inside `llm`

## References

- ADR 0006: `docs/adr/0006-llm-provider-adapters.md`
- Config: `.agent-review.example.json` `agent`
- Types: `src/agent-backend/types.ts`
