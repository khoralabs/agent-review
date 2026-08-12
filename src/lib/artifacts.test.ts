import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadRunArtifact,
  persistReviewArtifacts,
  runDiffGzipPath,
  toRepoRelativePath,
  writeRunArtifact,
} from "./artifacts.ts";
import { runArtifactPath, runDir } from "./paths.ts";

describe("persistReviewArtifacts", () => {
  test("writes success and error runs with repo-relative paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-art-"));

    const ok = persistReviewArtifacts({
      cwd: dir,
      outputDir: dir,
      runId: "run-ok",
      scope: "commit",
      commit: "HEAD",
      gitHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      staticHash: "s",
      runtimeHash: "r",
      exitCode: 0,
      result: { summary: "clean", findings: [] },
      files: ["a.ts"],
      model: "test",
      diagnostics: [],
    });
    expect(fs.existsSync(ok.runPath)).toBe(true);
    expect(ok.relativeRunPath).toBe("reviews/run-ok/run.json");
    expect(ok.relativeReviewsPath).toBe("reviews.jsonl");
    expect(ok.relativeFindingsPath).toBe("findings.jsonl");
    const okJson = JSON.parse(fs.readFileSync(ok.runPath, "utf8")) as {
      ok: boolean;
      artifactPath: string;
      gitHead?: string;
    };
    expect(okJson.ok).toBe(true);
    expect(okJson.artifactPath).toBe("reviews/run-ok/run.json");
    expect(okJson.gitHead).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const bad = persistReviewArtifacts({
      cwd: dir,
      outputDir: dir,
      runId: "run-err",
      scope: "commit",
      commit: "HEAD",
      exitCode: 2,
      error: "boom",
      files: [],
      model: "test",
      diagnostics: [],
    });
    const parsed = JSON.parse(fs.readFileSync(bad.runPath, "utf8")) as {
      ok: boolean;
      error: string;
      exitCode: number;
      artifactPath: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("boom");
    expect(parsed.exitCode).toBe(2);
    expect(parsed.artifactPath).toBe("reviews/run-err/run.json");

    const lines = fs.readFileSync(path.join(dir, "reviews.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}") as {
      path: string;
      gitHead?: string;
    };
    expect(first.path).toBe("reviews/run-ok/run.json");
    expect(first.gitHead).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(fs.existsSync(path.join(dir, "findings.jsonl"))).toBe(false);
  });

  test("stamps fingerprints and appends findings.jsonl", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-find-"));
    const written = persistReviewArtifacts({
      cwd: dir,
      outputDir: dir,
      runId: "run-f",
      scope: "staged",
      gitHead: "ffffffffffffffffffffffffffffffffffffffff",
      staticHash: "static-1",
      exitCode: 0,
      result: {
        summary: "one finding",
        findings: [
          {
            severity: "warning",
            key: "unstable-fallback",
            file: "a.ts",
            message: "wording A",
            rule: "hooks",
          },
        ],
      },
      files: ["a.ts"],
      model: "test",
      diagnostics: [],
    });

    const onDisk = JSON.parse(fs.readFileSync(written.runPath, "utf8")) as {
      findings: Array<{ key: string; fingerprint: string; message: string }>;
    };
    expect(onDisk.findings[0]?.key).toBe("unstable-fallback");
    expect(onDisk.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    const again = persistReviewArtifacts({
      cwd: dir,
      outputDir: dir,
      runId: "run-f2",
      scope: "staged",
      gitHead: "ffffffffffffffffffffffffffffffffffffffff",
      staticHash: "static-1",
      exitCode: 0,
      result: {
        summary: "same issue",
        findings: [
          {
            severity: "warning",
            key: "unstable-fallback",
            file: "a.ts",
            message: "completely different prose",
            rule: "hooks",
          },
        ],
      },
      files: ["a.ts"],
      model: "test",
      diagnostics: [],
    });
    const onDisk2 = JSON.parse(fs.readFileSync(again.runPath, "utf8")) as {
      findings: Array<{ fingerprint: string }>;
    };
    expect(onDisk2.findings[0]?.fingerprint).toBe(onDisk.findings[0]?.fingerprint);

    const findingLines = fs
      .readFileSync(path.join(dir, "findings.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(findingLines).toHaveLength(2);
    const row = JSON.parse(findingLines[0] ?? "{}") as {
      key: string;
      fingerprint: string;
      gitHead?: string;
      staticHash?: string;
      path: string;
    };
    expect(row.key).toBe("unstable-fallback");
    const findingFingerprint = onDisk.findings[0]?.fingerprint;
    expect(findingFingerprint).toBeTruthy();
    expect(row.fingerprint).toBe(findingFingerprint as string);
    expect(row.gitHead).toBe("ffffffffffffffffffffffffffffffffffffffff");
    expect(row.staticHash).toBe("static-1");
    expect(row.path).toBe("reviews/run-f/run.json");
  });

  test("stores diff as gzip sidecar, not inline JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-ckpt-"));
    const reviewsPath = path.join(dir, "reviews.jsonl");
    const diffText = "diff --git a/a.ts b/a.ts\n+x".repeat(50);

    const written = writeRunArtifact({
      cwd: dir,
      outputDir: dir,
      runId: "run-ckpt",
      scope: "staged",
      exitCode: 2,
      result: {
        summary: "pending triage",
        findings: [
          {
            severity: "warning",
            key: "test-issue",
            file: "a.ts",
            message: "needs triage",
          },
        ],
      },
      files: ["a.ts"],
      model: "test",
      diff: diffText,
      commitMessage: "feat: test",
      truncated: false,
      empty: false,
      diagnostics: [],
    });

    expect(fs.existsSync(reviewsPath)).toBe(false);
    expect(written.diffGzipPath).toBe(runDiffGzipPath(dir, "run-ckpt"));
    expect(written.relativeDiffGzipPath).toBe("reviews/run-ckpt/diff.gz");
    expect(written.diffGzipPath !== undefined).toBe(true);
    if (written.diffGzipPath === undefined) {
      throw new Error("expected diffGzipPath");
    }
    expect(fs.existsSync(written.diffGzipPath)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(written.runPath, "utf8")) as {
      diff?: string;
      diffGzip?: boolean;
      artifactPath: string;
      summary: string;
    };
    expect(onDisk.diff).toBeUndefined();
    expect(onDisk.diffGzip).toBe(true);
    expect(onDisk.artifactPath).toBe("reviews/run-ckpt/run.json");
    expect(fs.statSync(written.diffGzipPath).size).toBeLessThan(
      Buffer.byteLength(diffText, "utf8"),
    );

    const loaded = loadRunArtifact(dir, "run-ckpt");
    expect(loaded.summary).toBe("pending triage");
    expect(loaded.findings).toHaveLength(1);
    expect(loaded.diff).toBe(diffText);
    expect(loaded.commitMessage).toBe("feat: test");

    const final = persistReviewArtifacts({
      cwd: dir,
      outputDir: dir,
      runId: "run-ckpt",
      scope: "staged",
      exitCode: 2,
      error: "analyst failed",
      result: {
        summary: "pending triage",
        findings: [
          {
            severity: "warning",
            key: "test-issue",
            file: "a.ts",
            message: "needs triage",
          },
        ],
      },
      files: ["a.ts"],
      model: "test",
      diff: loaded.diff,
      commitMessage: loaded.commitMessage,
      diagnostics: [],
    });

    const overwritten = JSON.parse(fs.readFileSync(final.runPath, "utf8")) as {
      error?: string;
      findings: Array<{ message: string }>;
      diff?: string;
      diffGzip?: boolean;
      artifactPath: string;
    };
    expect(overwritten.error).toBe("analyst failed");
    expect(overwritten.findings).toHaveLength(1);
    expect(overwritten.diff).toBeUndefined();
    expect(overwritten.diffGzip).toBe(true);
    expect(overwritten.artifactPath).toBe("reviews/run-ckpt/run.json");
    expect(loadRunArtifact(dir, "run-ckpt").diff).toBe(diffText);

    const lines = fs.readFileSync(reviewsPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  test("toRepoRelativePath uses forward slashes", () => {
    const cwd = "/tmp/repo";
    const abs = path.join(cwd, ".data", "agent-review", "reviews", "x", "run.json");
    expect(toRepoRelativePath(cwd, abs)).toBe(".data/agent-review/reviews/x/run.json");
  });

  test("loadRunArtifact fails when diffGzip flag set but sidecar missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-miss-"));
    const missDir = runDir(dir, "run-miss");
    fs.mkdirSync(missDir, { recursive: true });
    fs.writeFileSync(
      runArtifactPath(dir, "run-miss"),
      `${JSON.stringify({
        runId: "run-miss",
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: "x",
        findings: [],
        files: [],
        model: "test",
        diffGzip: true,
        diagnostics: [],
        recordedAt: new Date().toISOString(),
        artifactPath: "reviews/run-miss/run.json",
      })}\n`,
    );
    expect(() => loadRunArtifact(dir, "run-miss")).toThrow(/sidecar missing/);
  });

  test("loadRunArtifact preserves legacy inline diff when no gzip sidecar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-legacy-"));
    fs.mkdirSync(runDir(dir, "run-legacy"), { recursive: true });
    const legacyDiff = "diff --git a/a.ts b/a.ts\n+ok\n";
    fs.writeFileSync(
      runArtifactPath(dir, "run-legacy"),
      `${JSON.stringify({
        runId: "run-legacy",
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: "legacy",
        findings: [],
        files: ["a.ts"],
        model: "test",
        diff: legacyDiff,
        diagnostics: [],
        recordedAt: new Date().toISOString(),
        artifactPath: "reviews/run-legacy/run.json",
      })}\n`,
    );
    const loaded = loadRunArtifact(dir, "run-legacy");
    expect(loaded.diff).toBe(legacyDiff);
    expect(loaded.diffGzip).toBeUndefined();
  });
});
