import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRunArtifact } from "./artifacts.ts";
import { migrateAgentReviewLayout } from "./migrate-layout.ts";

describe("migrateAgentReviewLayout", () => {
  test("converts legacy runs/ and remediations/ into reviews/<runId>/", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-mig-"));
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    fs.mkdirSync(path.join(dir, "remediations", "run-a-0"), {
      recursive: true,
    });

    const diffText = "diff --git a/x.ts b/x.ts\n+ok\n";
    fs.writeFileSync(
      path.join(dir, "runs", "run-a.diff.gz"),
      Bun.gzipSync(Buffer.from(diffText, "utf8")),
    );
    fs.writeFileSync(
      path.join(dir, "runs", "run-a.json"),
      `${JSON.stringify({
        runId: "run-a",
        scope: "staged",
        exitCode: 1,
        ok: false,
        summary: "issue",
        findings: [
          {
            severity: "error",
            key: "test-issue",
            file: "x.ts",
            message: "bug",
            decision: {
              agentId: "a",
              agentName: "A",
              staticHash: "s",
              invocationHash: "i",
              verdict: "remediate",
              task: "Fix",
              rationale: "yes",
              remediationPath: "remediations/run-a-0",
            },
          },
        ],
        files: ["x.ts"],
        model: "test",
        diffGzip: true,
        diagnostics: [],
        recordedAt: "2026-08-11T00:00:00.000Z",
        artifactPath: "runs/run-a.json",
      })}\n`,
    );
    fs.writeFileSync(
      path.join(dir, "remediations", "run-a-0", "_plan.md"),
      "# Fix\n\n- Source: runs/run-a.json finding[0]\n",
    );
    fs.writeFileSync(path.join(dir, "remediations", "run-a-0", "changes.md"), "# Changes\n");
    fs.writeFileSync(
      path.join(dir, "reviews.jsonl"),
      `${JSON.stringify({
        runId: "run-a",
        path: "runs/run-a.json",
        exitCode: 1,
        ok: false,
      })}\n`,
    );

    const result = migrateAgentReviewLayout({ cwd: dir, outputDir: dir });
    expect(result.alreadyMigrated).toBe(false);
    expect(result.migratedRuns).toEqual(["run-a"]);
    expect(result.migratedRemediations).toEqual([{ runId: "run-a", index: "0" }]);
    expect(fs.existsSync(path.join(dir, "runs"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "remediations"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "reviews", "run-a", "run.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "reviews", "run-a", "diff.gz"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "reviews", "run-a", "remediations", "0", "plan.md"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(dir, "reviews", "run-a", "remediations", "0", "changes.md")),
    ).toBe(true);

    const loaded = loadRunArtifact(dir, "run-a");
    expect(loaded.artifactPath).toBe("reviews/run-a/run.json");
    expect(loaded.diff).toBe(diffText);
    expect(loaded.findings[0]?.decision?.verdict).toBe("remediate");
    if (loaded.findings[0]?.decision?.verdict === "remediate") {
      expect(loaded.findings[0].decision.remediationPath).toBe("reviews/run-a/remediations/0");
    }

    const plan = fs.readFileSync(
      path.join(dir, "reviews", "run-a", "remediations", "0", "plan.md"),
      "utf8",
    );
    expect(plan).toContain("Source: reviews/run-a/run.json finding[0]");

    const indexLine = JSON.parse(
      fs.readFileSync(path.join(dir, "reviews.jsonl"), "utf8").trim(),
    ) as { path: string };
    expect(indexLine.path).toBe("reviews/run-a/run.json");

    const again = migrateAgentReviewLayout({ cwd: dir, outputDir: dir });
    expect(again.alreadyMigrated).toBe(true);
  });

  test("normalizes backslash remediation paths when rewriting run JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-mig-"));
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "runs", "run-win.json"),
      `${JSON.stringify({
        runId: "run-win",
        scope: "staged",
        exitCode: 1,
        ok: false,
        summary: "issue",
        findings: [
          {
            severity: "error",
            key: "test-issue",
            file: "x.ts",
            message: "bug",
            decision: {
              agentId: "a",
              agentName: "A",
              staticHash: "s",
              invocationHash: "i",
              verdict: "remediate",
              task: "Fix",
              rationale: "yes",
              remediationPath: "remediations\\run-win-2",
            },
          },
        ],
        files: ["x.ts"],
        model: "test",
        diagnostics: [],
        recordedAt: "2026-08-11T00:00:00.000Z",
        artifactPath: "runs/run-win.json",
      })}\n`,
    );

    migrateAgentReviewLayout({ cwd: dir, outputDir: dir });
    const loaded = loadRunArtifact(dir, "run-win");
    expect(loaded.findings[0]?.decision?.verdict).toBe("remediate");
    if (loaded.findings[0]?.decision?.verdict === "remediate") {
      expect(loaded.findings[0].decision.remediationPath).toBe("reviews/run-win/remediations/2");
    }
  });

  test("resumes after partial migration leaving orphaned diff.gz", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-mig-"));
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    fs.mkdirSync(path.join(dir, "reviews", "run-partial"), { recursive: true });

    const diffText = "diff --git a/y.ts b/y.ts\n+partial\n";
    fs.writeFileSync(
      path.join(dir, "runs", "run-partial.diff.gz"),
      Bun.gzipSync(Buffer.from(diffText, "utf8")),
    );
    fs.writeFileSync(
      path.join(dir, "reviews", "run-partial", "run.json"),
      `${JSON.stringify({
        runId: "run-partial",
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: "ok",
        findings: [],
        files: [],
        model: "test",
        diffGzip: true,
        diagnostics: [],
        recordedAt: "2026-08-11T00:00:00.000Z",
        artifactPath: "reviews/run-partial/run.json",
      })}\n`,
    );

    const result = migrateAgentReviewLayout({ cwd: dir, outputDir: dir });
    expect(result.alreadyMigrated).toBe(false);
    expect(result.migratedRuns).toEqual(["run-partial"]);
    expect(fs.existsSync(path.join(dir, "runs"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "reviews", "run-partial", "diff.gz"))).toBe(true);

    const loaded = loadRunArtifact(dir, "run-partial");
    expect(loaded.diff).toBe(diffText);
  });

  test("does not rewrite already-migrated reviews when migrating another run", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-mig-"));
    fs.mkdirSync(path.join(dir, "reviews", "run-existing"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });

    const existingPath = path.join(dir, "reviews", "run-existing", "run.json");
    const existingBody = `${JSON.stringify({
      runId: "run-existing",
      scope: "staged",
      exitCode: 0,
      ok: true,
      summary: "already new layout",
      findings: [],
      files: [],
      model: "test",
      diagnostics: [],
      recordedAt: "2026-08-11T00:00:00.000Z",
      artifactPath: "reviews/run-existing/run.json",
      sentinel: "untouched",
    })}\n`;
    fs.writeFileSync(existingPath, existingBody);
    const mtimeBefore = fs.statSync(existingPath).mtimeMs;

    fs.writeFileSync(
      path.join(dir, "runs", "run-new.json"),
      `${JSON.stringify({
        runId: "run-new",
        scope: "staged",
        exitCode: 1,
        ok: false,
        summary: "issue",
        findings: [],
        files: [],
        model: "test",
        diagnostics: [],
        recordedAt: "2026-08-11T00:00:00.000Z",
        artifactPath: "runs/run-new.json",
      })}\n`,
    );

    // Ensure mtime can differ on fast filesystems.
    const waitUntil = mtimeBefore + 5;
    while (Date.now() < waitUntil) {
      /* spin */
    }

    migrateAgentReviewLayout({ cwd: dir, outputDir: dir });

    expect(fs.readFileSync(existingPath, "utf8")).toBe(existingBody);
    expect(fs.statSync(existingPath).mtimeMs).toBe(mtimeBefore);
    expect(fs.existsSync(path.join(dir, "reviews", "run-new", "run.json"))).toBe(true);
  });

  test("ignores .DS_Store leftover in legacy runs/", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-mig-"));
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "runs", ".DS_Store"), "macOS junk");
    fs.writeFileSync(
      path.join(dir, "runs", "run-ds.json"),
      `${JSON.stringify({
        runId: "run-ds",
        scope: "staged",
        exitCode: 0,
        ok: true,
        summary: "ok",
        findings: [],
        files: [],
        model: "test",
        diagnostics: [],
        recordedAt: "2026-08-11T00:00:00.000Z",
        artifactPath: "runs/run-ds.json",
      })}\n`,
    );

    const result = migrateAgentReviewLayout({ cwd: dir, outputDir: dir });
    expect(result.migratedRuns).toEqual(["run-ds"]);
    expect(fs.existsSync(path.join(dir, "runs"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "reviews", "run-ds", "run.json"))).toBe(true);
  });

  test("skips non-matching remediation dirs instead of aborting", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-mig-"));
    fs.mkdirSync(path.join(dir, "remediations", "run-ok-0"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dir, "remediations", "notes-backup"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, "remediations", "run-ok-0", "_plan.md"),
      "# Fix\n\n- Source: runs/run-ok.json finding[0]\n",
    );
    fs.writeFileSync(path.join(dir, "remediations", "notes-backup", "readme.txt"), "keep me\n");

    const result = migrateAgentReviewLayout({ cwd: dir, outputDir: dir });
    expect(result.migratedRemediations).toEqual([{ runId: "run-ok", index: "0" }]);
    expect(fs.existsSync(path.join(dir, "reviews", "run-ok", "remediations", "0", "plan.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dir, "remediations", "notes-backup", "readme.txt"))).toBe(true);
  });
});
