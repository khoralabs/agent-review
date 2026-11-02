import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_OUTPUT_DIR, resolveOutputDir } from "./observability.ts";

describe("resolveOutputDir", () => {
  test("symlinks cwd/.data to ../.data when parent shares .data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-obs-"));
    const parentData = path.join(root, ".data");
    const worktree = path.join(root, "worktree-a");
    fs.mkdirSync(parentData, { recursive: true });
    fs.mkdirSync(path.join(parentData, "agent-review"), { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });

    const out = resolveOutputDir(worktree);
    expect(out).toBe(path.join(worktree, DEFAULT_OUTPUT_DIR));
    expect(fs.lstatSync(path.join(worktree, ".data")).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(worktree, ".data"))).toBe("../.data");
    expect(fs.realpathSync(out)).toBe(fs.realpathSync(path.join(parentData, "agent-review")));

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns lexical local path when absolute outputDir realpaths to cwd/.data/agent-review", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-obs-abs-"));
    const parentData = path.join(root, ".data");
    const worktree = path.join(root, "repo");
    fs.mkdirSync(path.join(parentData, "agent-review"), { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    fs.symlinkSync("../.data", path.join(worktree, ".data"));

    const absolute = path.join(parentData, "agent-review");
    const out = resolveOutputDir(worktree, absolute);
    expect(out).toBe(path.resolve(worktree, DEFAULT_OUTPUT_DIR));
    expect(out).not.toBe(absolute);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("leaves absolute outputDir unchanged when unrelated", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-obs-other-"));
    const other = path.join(root, "elsewhere", "agent-review");
    fs.mkdirSync(other, { recursive: true });
    const out = resolveOutputDir(root, other);
    expect(out).toBe(other);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns lexical local path when absolute outputDir leaf does not exist yet", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-obs-missing-"));
    const parentData = path.join(root, ".data");
    const worktree = path.join(root, "repo");
    fs.mkdirSync(parentData, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    fs.symlinkSync("../.data", path.join(worktree, ".data"), "dir");

    const absolute = path.join(parentData, "agent-review");
    expect(fs.existsSync(absolute)).toBe(false);
    const out = resolveOutputDir(worktree, absolute);
    expect(out).toBe(path.resolve(worktree, DEFAULT_OUTPUT_DIR));

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("ignores parent .data when it is a regular file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-obs-file-"));
    const worktree = path.join(root, "repo");
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(root, ".data"), "not-a-dir", "utf8");

    const out = resolveOutputDir(worktree);
    expect(out).toBe(path.resolve(worktree, DEFAULT_OUTPUT_DIR));
    expect(fs.existsSync(path.join(worktree, ".data"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
