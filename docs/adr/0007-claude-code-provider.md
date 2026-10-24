# ADR 0007: Claude Code provider

## Status

Proposed

## Context

Teams that already pay for Claude subscriptions want agent-review to run on
them instead of a metered token API. Claude Code is the supported way to use a
subscription from code; the `anthropic` adapter (ADR 0006) only takes an API
key. Claude Code also exposes a reasoning effort level that no other adapter
had a config slot for.

Forces:

- The Claude Agent SDK ships a platform-specific Claude Code binary (about
  220 MB), which Gateway and OpenRouter users should not have to install
- Claude Code runs its own tool loop: AI SDK tools such as `inspectBash` are
  ignored by the provider
- Billing must not move to an API key just because `ANTHROPIC_API_KEY` is set
  in the shell or `.env`

## Decision

We will add a `claude-code` adapter backed by `ai-sdk-provider-claude-code`,
declared as an optional peer dependency and loaded only when the provider is
selected. The adapter:

- gives Claude Code only the read-only `Read`, `Grep`, and `Glob` tools, denies
  reads of `.env*` files, and tells the model that `inspectBash` is not there
- loads no user or project settings and no MCP servers, and does not persist
  sessions
- removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
  and the `CLAUDE_CODE_USE_*` cloud selectors from the Claude Code environment,
  so it uses the `claude` login or `CLAUDE_CODE_OAUTH_TOKEN`
- runs Claude Code in the checkout under review, so `walk` workers read their
  own commit
- accepts Claude aliases and ids, and strips a Gateway-style `anthropic/` prefix
- creates a fresh provider model for each call, because a provider model
  resumes its previous Claude Code session on the next call
- drops AI SDK `tools`, `toolChoice`, and `maxOutputTokens`, which Claude Code
  cannot use, and nests non-object output schemas (the analyst `oneOf`) under
  `value`, because Claude Code sends the schema as a tool `input_schema` that
  must be `type: "object"`

We will add `llm.effort` (`low` to `max`), `--effort`, and
`AGENT_REVIEW_LLM_EFFORT`, passed to adapters as `ctx.effort`. Only
`claude-code` reads it today.

## Consequences

### Positive

- Reviews can run on a Claude subscription with a choice of model and effort
- Gateway stays the default; other providers are unchanged

### Negative

- Review tool calls are Claude Code built-ins, so `inspectBash` command policy
  and tool hashes do not apply on this provider
- Each run starts a Claude Code process, which is slower than a direct API call
- Anthropic's Agent SDK terms restrict third-party products from offering
  claude.ai login without approval; maintainers should confirm this use fits

### Neutral

- `capabilitiesGenerateText` and the structured-output path are unchanged

## References

- ADR 0006: LLM provider adapters
- [ai-sdk-provider-claude-code](https://github.com/ben-vargas/ai-sdk-provider-claude-code)
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
