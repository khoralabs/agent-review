import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import { DEFAULT_LLM_CONFIG } from "../llm/types.ts";
import {
  clearAgentBackendFactoriesForTests,
  ensureBuiltInAgentBackends,
  listAgentBackendIds,
  parseCliStdout,
  resolveAgentBackend,
} from "./index.ts";

const fixtureSchema = z.object({
  ok: z.boolean(),
  note: z.string(),
});

describe("agent backend registry", () => {
  test("defaults resolve to llm", () => {
    ensureBuiltInAgentBackends();
    const backend = resolveAgentBackend({
      agent: { backend: "llm" },
      llm: DEFAULT_LLM_CONFIG,
      testModel: true,
    });
    expect(backend.id).toBe("llm");
  });

  test("unknown backend throws with known ids", () => {
    ensureBuiltInAgentBackends();
    expect(() =>
      resolveAgentBackend({
        agent: { backend: "nope" },
        llm: DEFAULT_LLM_CONFIG,
      }),
    ).toThrow(/Unknown agent backend "nope"/);
    expect(listAgentBackendIds()).toContain("llm");
    expect(listAgentBackendIds()).toContain("cli");
  });

  test("clear + ensure re-registers built-ins", () => {
    clearAgentBackendFactoriesForTests();
    expect(listAgentBackendIds()).toEqual([]);
    ensureBuiltInAgentBackends();
    expect(listAgentBackendIds()).toEqual(["cli", "llm"]);
  });

  test("cli factory requires command", () => {
    ensureBuiltInAgentBackends();
    expect(() =>
      resolveAgentBackend({
        agent: { backend: "cli" },
        llm: DEFAULT_LLM_CONFIG,
      }),
    ).toThrow(/requires agent\.cli\.command/);
  });

  test("resolves when agent config is omitted", () => {
    ensureBuiltInAgentBackends();
    const backend = resolveAgentBackend({ llm: DEFAULT_LLM_CONFIG, testModel: true });
    expect(backend.id).toBe("llm");
  });
});

describe("parseCliStdout", () => {
  test("extracts JSON after logs and a markdown fence", () => {
    const stdout = [
      "starting…",
      "tool: read foo.ts",
      "```json",
      '{"ok":true,"note":"fenced"}',
      "```",
      "",
    ].join("\n");
    expect(parseCliStdout(stdout, fixtureSchema)).toEqual({ ok: true, note: "fenced" });
  });

  test("extracts trailing raw JSON after logs", () => {
    const stdout = 'log line one\nlog line two\n{"ok":true,"note":"trailing"}\n';
    expect(parseCliStdout(stdout, fixtureSchema)).toEqual({ ok: true, note: "trailing" });
  });

  test("extracts outer object when payload contains nested braces", () => {
    const nestedSchema = z.object({
      ok: z.boolean(),
      nested: z.object({ x: z.number() }),
    });
    const stdout = 'progress { step: 1 }\n{"ok":true,"nested":{"x":2}}\n';
    expect(parseCliStdout(stdout, nestedSchema)).toEqual({
      ok: true,
      nested: { x: 2 },
    });
  });
});

describe("cli agent backend", () => {
  test("spawns fixture script and parses JSON stdout", async () => {
    ensureBuiltInAgentBackends();
    const dir = await mkdtemp(path.join(tmpdir(), "agent-review-cli-fixture-"));
    const script = path.join(dir, "fake-agent.sh");
    await writeFile(
      script,
      `#!/bin/sh
# echo structured JSON for agent-review cli backend
printf '%s\\n' '{"ok":true,"note":"from-cli"}'
`,
      "utf8",
    );
    await chmod(script, 0o755);

    const backend = resolveAgentBackend({
      agent: {
        backend: "cli",
        cli: { command: script, timeoutMs: 10_000 },
      },
      llm: DEFAULT_LLM_CONFIG,
    });

    const result = await backend.run({
      role: "review",
      runId: "test-run",
      cwd: dir,
      system: "sys",
      prompt: "do the thing",
      outputSchema: fixtureSchema,
    });

    expect(result.output).toEqual({ ok: true, note: "from-cli" });
    expect(result.agentId).toBe("agent-review-cli");
    expect(result.link.staticHash.length).toBeGreaterThan(0);
    expect(result.link.runtimeHash.length).toBeGreaterThan(0);
  });

  test("non-zero exit fails", async () => {
    ensureBuiltInAgentBackends();
    const dir = await mkdtemp(path.join(tmpdir(), "agent-review-cli-fail-"));
    const script = path.join(dir, "fail-agent.sh");
    await writeFile(
      script,
      `#!/bin/sh
echo boom >&2
exit 3
`,
      "utf8",
    );
    await chmod(script, 0o755);

    const backend = resolveAgentBackend({
      agent: {
        backend: "cli",
        cli: { command: script, timeoutMs: 10_000 },
      },
      llm: DEFAULT_LLM_CONFIG,
    });

    await expect(
      backend.run({
        role: "analyze",
        runId: "fail-run",
        cwd: dir,
        system: "",
        prompt: "x",
        outputSchema: fixtureSchema,
      }),
    ).rejects.toThrow(/exited 3/);
  });

  test("{{taskFile}} placeholder writes file and passes path", async () => {
    ensureBuiltInAgentBackends();
    const dir = await mkdtemp(path.join(tmpdir(), "agent-review-cli-file-"));
    const script = path.join(dir, "file-agent.sh");
    await writeFile(
      script,
      `#!/bin/sh
# $1 = task file path
test -f "$1" || exit 4
printf '%s\\n' '{"ok":true,"note":"from-file"}'
`,
      "utf8",
    );
    await chmod(script, 0o755);

    const backend = resolveAgentBackend({
      agent: {
        backend: "cli",
        cli: {
          command: script,
          args: ["{{taskFile}}"],
          timeoutMs: 10_000,
        },
      },
      llm: DEFAULT_LLM_CONFIG,
    });

    const result = await backend.run({
      role: "commitMessage",
      runId: "file-run",
      cwd: dir,
      system: "sys",
      prompt: "prompt body",
      outputSchema: fixtureSchema,
    });
    expect(result.output.note).toBe("from-file");
  });

  test("clears unused timeout after normal completion", async () => {
    ensureBuiltInAgentBackends();
    const dir = await mkdtemp(path.join(tmpdir(), "agent-review-cli-clear-"));
    const script = path.join(dir, "fast-agent.sh");
    await writeFile(
      script,
      `#!/bin/sh
printf '%s\\n' '{"ok":true,"note":"fast"}'
`,
      "utf8",
    );
    await chmod(script, 0o755);

    const backend = resolveAgentBackend({
      agent: {
        backend: "cli",
        cli: { command: script, timeoutMs: 5_000 },
      },
      llm: DEFAULT_LLM_CONFIG,
    });

    const started = Date.now();
    const result = await backend.run({
      role: "review",
      runId: "clear-timeout-run",
      cwd: dir,
      system: "",
      prompt: "x",
      outputSchema: fixtureSchema,
    });
    expect(result.output.note).toBe("fast");
    // Must not wait out the unused 5s timeout (timer cleared in finally).
    expect(Date.now() - started).toBeLessThan(3_000);
    await Bun.sleep(200);
  });

  test("times out without hanging when subprocess ignores SIGTERM", async () => {
    ensureBuiltInAgentBackends();
    const dir = await mkdtemp(path.join(tmpdir(), "agent-review-cli-timeout-"));
    const script = path.join(dir, "hang-agent.sh");
    await writeFile(
      script,
      `#!/bin/sh
trap '' TERM
sleep 60
`,
      "utf8",
    );
    await chmod(script, 0o755);

    const backend = resolveAgentBackend({
      agent: {
        backend: "cli",
        cli: { command: script, timeoutMs: 400 },
      },
      llm: DEFAULT_LLM_CONFIG,
    });

    const started = Date.now();
    await expect(
      backend.run({
        role: "review",
        runId: "timeout-run",
        cwd: dir,
        system: "",
        prompt: "x",
        outputSchema: fixtureSchema,
      }),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});
