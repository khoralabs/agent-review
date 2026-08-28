import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendWorkstreamWorkLog,
  clearActiveWorkstreamId,
  doneWorkstream,
  linkReviewToWorkstream,
  maybeLinkReviewToWorkstream,
  readActiveWorkstreamId,
  resumeWorkstream,
  startWorkstream,
} from "./workstreams.ts";

function makeReview(dir: string, runId: string): string {
  const review = path.join(dir, "reviews", runId);
  fs.mkdirSync(review, { recursive: true });
  fs.writeFileSync(path.join(review, "run.json"), JSON.stringify({ runId }), "utf8");
  return review;
}

describe("workstreams", () => {
  test("start creates stubs, index, and active pointer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    const at = new Date(Date.UTC(2026, 7, 28, 14, 30, 0));
    const started = startWorkstream({
      cwd: dir,
      outputDir: dir,
      shortSha: "abc1234",
      gitHead: "abc1234full",
      title: "Example",
      at,
    });

    expect(started.workstreamId).toBe("20260828T143000Z-abc1234");
    expect(readActiveWorkstreamId(dir)).toBe(started.workstreamId);
    expect(fs.existsSync(path.join(started.absoluteDir, "chunks.json"))).toBe(true);
    expect(fs.existsSync(path.join(started.absoluteDir, "adr.md"))).toBe(true);
    expect(fs.existsSync(path.join(started.absoluteDir, "todo.md"))).toBe(true);
    expect(fs.existsSync(path.join(started.absoluteDir, "commits"))).toBe(true);

    const chunks = JSON.parse(
      fs.readFileSync(path.join(started.absoluteDir, "chunks.json"), "utf8"),
    ) as { chunks: unknown[] };
    expect(chunks.chunks).toEqual([]);

    const indexLine = fs.readFileSync(path.join(dir, "workstreams.jsonl"), "utf8").trim();
    const parsed = JSON.parse(indexLine) as {
      workstreamId: string;
      title?: string;
      status: string;
    };
    expect(parsed.workstreamId).toBe(started.workstreamId);
    expect(parsed.title).toBe("Example");
    expect(parsed.status).toBe("active");
  });

  test("link creates relative symlink; idempotent on second call", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    const started = startWorkstream({
      cwd: dir,
      outputDir: dir,
      shortSha: "deadbee",
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    });
    const runId = "20260101T000001Z-deadbee";
    makeReview(dir, runId);

    const linked = linkReviewToWorkstream({
      cwd: dir,
      outputDir: dir,
      workstreamId: started.workstreamId,
      runId,
    });
    expect(linked.created).toBe(true);
    expect(fs.lstatSync(linked.linkPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(linked.linkPath)).toBe(
      fs.realpathSync(path.join(dir, "reviews", runId)),
    );

    const again = linkReviewToWorkstream({
      cwd: dir,
      outputDir: dir,
      workstreamId: started.workstreamId,
      runId,
    });
    expect(again.created).toBe(false);
  });

  test("maybeLink uses active when autoLink; skips when autoLink false unless explicit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    const started = startWorkstream({
      cwd: dir,
      outputDir: dir,
      shortSha: "cafebabe",
      at: new Date(Date.UTC(2026, 0, 2, 0, 0, 0)),
    });
    const runId = "20260102T000001Z-cafebabe";
    makeReview(dir, runId);

    expect(
      maybeLinkReviewToWorkstream({
        cwd: dir,
        outputDir: dir,
        runId,
        autoLink: false,
      }),
    ).toBeUndefined();

    const auto = maybeLinkReviewToWorkstream({
      cwd: dir,
      outputDir: dir,
      runId,
      autoLink: true,
    });
    expect(auto?.workstreamId).toBe(started.workstreamId);
    expect(auto?.created).toBe(true);

    clearActiveWorkstreamId(dir);
    const runId2 = "20260102T000002Z-cafebabe";
    makeReview(dir, runId2);
    expect(
      maybeLinkReviewToWorkstream({
        cwd: dir,
        outputDir: dir,
        runId: runId2,
        autoLink: true,
      }),
    ).toBeUndefined();

    const explicit = maybeLinkReviewToWorkstream({
      cwd: dir,
      outputDir: dir,
      runId: runId2,
      workstreamId: started.workstreamId,
      autoLink: false,
    });
    expect(explicit?.created).toBe(true);
  });

  test("resume and done manage active pointer; work-log appends", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    const started = startWorkstream({
      cwd: dir,
      outputDir: dir,
      shortSha: "feedfac",
      at: new Date(Date.UTC(2026, 0, 3, 0, 0, 0)),
    });
    clearActiveWorkstreamId(dir);
    expect(readActiveWorkstreamId(dir)).toBeUndefined();

    const resumed = resumeWorkstream({
      cwd: dir,
      outputDir: dir,
      workstreamId: started.workstreamId,
    });
    expect(readActiveWorkstreamId(dir)).toBe(resumed.workstreamId);

    appendWorkstreamWorkLog({
      cwd: dir,
      outputDir: dir,
      workstreamId: started.workstreamId,
      entry: { event: "note", message: "progress" },
    });

    const done = doneWorkstream({
      cwd: dir,
      outputDir: dir,
      message: "shipped",
    });
    expect(done.clearedActive).toBe(true);
    expect(readActiveWorkstreamId(dir)).toBeUndefined();

    const log = fs
      .readFileSync(path.join(started.absoluteDir, "work-log.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(log.length).toBeGreaterThanOrEqual(2);
    const lastLine = log.at(-1);
    expect(lastLine).toBeDefined();
    const last = JSON.parse(lastLine as string) as { event: string; status?: string };
    expect(last.event).toBe("done");
    expect(last.status).toBe("done");
  });

  test("maybeLink never throws on missing review", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    startWorkstream({
      cwd: dir,
      outputDir: dir,
      shortSha: "0000000",
      at: new Date(Date.UTC(2026, 0, 4, 0, 0, 0)),
    });
    expect(
      maybeLinkReviewToWorkstream({
        cwd: dir,
        outputDir: dir,
        runId: "missing-run",
        autoLink: true,
      }),
    ).toBeUndefined();
  });

  test("rejects dot catalog ids", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    fs.mkdirSync(path.join(dir, "workstreams"), { recursive: true });
    expect(() =>
      linkReviewToWorkstream({
        cwd: dir,
        outputDir: dir,
        workstreamId: ".",
        runId: "20260101T000000Z-abc",
      }),
    ).toThrow(/invalid workstream id/);
    expect(() =>
      linkReviewToWorkstream({
        cwd: dir,
        outputDir: dir,
        workstreamId: "20260101T000000Z-abc",
        runId: "..",
      }),
    ).toThrow(/invalid runId/);
  });

  test("replaces mismatched or dangling commit symlinks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    const started = startWorkstream({
      cwd: dir,
      outputDir: dir,
      shortSha: "relink1",
      at: new Date(Date.UTC(2026, 0, 5, 0, 0, 0)),
    });
    const runId = "20260105T000001Z-relink1";
    makeReview(dir, runId);
    const linkPath = path.join(started.absoluteDir, "commits", runId);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(path.join("..", "..", "..", "reviews", "missing"), linkPath);

    const linked = linkReviewToWorkstream({
      cwd: dir,
      outputDir: dir,
      workstreamId: started.workstreamId,
      runId,
    });
    expect(linked.created).toBe(true);
    expect(fs.realpathSync(linked.linkPath)).toBe(
      fs.realpathSync(path.join(dir, "reviews", runId)),
    );
  });

  test("done index shortSha keeps hyphenated suffix after Z-", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ws-"));
    const started = startWorkstream({
      cwd: dir,
      outputDir: dir,
      shortSha: "abc-def",
      at: new Date(Date.UTC(2026, 0, 6, 0, 0, 0)),
    });
    expect(started.workstreamId).toBe("20260106T000000Z-abc-def");
    doneWorkstream({
      cwd: dir,
      outputDir: dir,
      workstreamId: started.workstreamId,
      message: "done",
    });
    const lines = fs.readFileSync(path.join(dir, "workstreams.jsonl"), "utf8").trim().split("\n");
    const doneLine = JSON.parse(lines[lines.length - 1] as string) as { shortSha: string };
    expect(doneLine.shortSha).toBe("abc-def");
  });
});
