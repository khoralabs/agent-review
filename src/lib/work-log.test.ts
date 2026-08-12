import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendWorkLog, resolveRemediationDir } from "./work-log.ts";

function makeRemediation(dir: string, runId: string, index: number): string {
  const remDir = path.join(dir, "reviews", runId, "remediations", String(index));
  fs.mkdirSync(remDir, { recursive: true });
  fs.writeFileSync(path.join(remDir, "plan.md"), "# Fix something\n");
  return remDir;
}

describe("work-log", () => {
  test("resolveRemediationDir accepts runId/index shorthand", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-wl-"));
    makeRemediation(dir, "run-0", 0);
    const resolved = resolveRemediationDir({
      cwd: dir,
      outputDir: dir,
      remediation: "run-0/0",
    });
    expect(resolved.relativeDir).toBe("reviews/run-0/remediations/0");
    expect(resolved.relativeWorkLogPath).toBe("reviews/run-0/remediations/0/work-log.jsonl");
  });

  test("resolveRemediationDir treats non-numeric 2-segment paths as cwd-relative", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-wl-"));
    const remDir = path.join(dir, "reviews", "my-remediations", "task-1");
    fs.mkdirSync(remDir, { recursive: true });
    fs.writeFileSync(path.join(remDir, "plan.md"), "# Fix something\n");

    const resolved = resolveRemediationDir({
      cwd: path.join(dir, "reviews"),
      outputDir: dir,
      remediation: "my-remediations/task-1",
    });
    expect(resolved.absoluteDir).toBe(remDir);
    expect(resolved.planPath).toBe(path.join(remDir, "plan.md"));
  });

  test("resolveRemediationDir rejects missing plan.md", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-wl-"));
    fs.mkdirSync(path.join(dir, "reviews", "run-x", "remediations", "0"), {
      recursive: true,
    });
    expect(() =>
      resolveRemediationDir({
        cwd: dir,
        outputDir: dir,
        remediation: "run-x/0",
      }),
    ).toThrow(/plan\.md/);
  });

  test("resolveRemediationDir rejects path traversal and absolute escapes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-wl-"));
    makeRemediation(dir, "run-ok", 0);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-out-"));
    fs.writeFileSync(path.join(outside, "plan.md"), "# outside\n");

    expect(() =>
      resolveRemediationDir({
        cwd: dir,
        outputDir: dir,
        remediation: path.join("..", "..", path.basename(outside)),
      }),
    ).toThrow(/escapes reviews/);

    expect(() =>
      resolveRemediationDir({
        cwd: dir,
        outputDir: dir,
        remediation: outside,
      }),
    ).toThrow(/escapes reviews/);
  });

  test("appendWorkLog writes JSONL and requires path for artifact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-wl-"));
    makeRemediation(dir, "run-1", 0);

    expect(() =>
      appendWorkLog({
        cwd: dir,
        outputDir: dir,
        remediation: "run-1/0",
        entry: { event: "artifact", message: "missing path" },
      }),
    ).toThrow(/artifact/);

    const written = appendWorkLog({
      cwd: dir,
      outputDir: dir,
      remediation: "reviews/run-1/remediations/0",
      entry: {
        event: "note",
        message: "looking into finding",
        agent: "cursor",
      },
      at: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(written.relativeWorkLogPath).toBe("reviews/run-1/remediations/0/work-log.jsonl");
    expect(written.entry.at).toBe("2026-08-11T12:00:00.000Z");

    appendWorkLog({
      cwd: dir,
      outputDir: dir,
      remediation: "run-1/0",
      entry: {
        event: "artifact",
        message: "notes",
        artifact: "investigation.md",
      },
    });

    appendWorkLog({
      cwd: dir,
      outputDir: dir,
      remediation: "run-1/0",
      entry: {
        event: "done",
        message: "fixed",
      },
    });

    const lines = fs.readFileSync(written.workLogPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    const first = JSON.parse(lines[0] ?? "{}") as {
      event: string;
      agent?: string;
    };
    expect(first.event).toBe("note");
    expect(first.agent).toBe("cursor");
    const last = JSON.parse(lines[2] ?? "{}") as { status?: string };
    expect(last.status).toBe("done");
  });
});
