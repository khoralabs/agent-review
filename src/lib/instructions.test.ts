import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isLiteralInstruction, joinSystemParts, loadInstructionsPrompt } from "./instructions.ts";

describe("isLiteralInstruction", () => {
  test("treats plain sentences as literals", () => {
    const cwd = os.tmpdir();
    expect(isLiteralInstruction("Prefer citing failing tests.", cwd)).toBe(true);
  });

  test("treats paths and globs as non-literal", () => {
    const cwd = os.tmpdir();
    expect(isLiteralInstruction("docs/a.md", cwd)).toBe(false);
    expect(isLiteralInstruction("**/*.txt", cwd)).toBe(false);
    expect(isLiteralInstruction("notes.md", cwd)).toBe(false);
  });
});

describe("joinSystemParts", () => {
  test("joins non-empty parts", () => {
    expect(joinSystemParts("a", "", "  ", "b")).toBe("a\n\nb");
  });
});

describe("loadInstructionsPrompt", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test("loads literals and md/txt files; ignores other extensions in globs", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-instr-"));
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "style.md"), "Use short sentences.\n");
    fs.writeFileSync(path.join(dir, "docs", "extra.txt"), "Cite tests.\n");
    fs.writeFileSync(path.join(dir, "docs", "skip.json"), "{}\n");

    const loaded = await loadInstructionsPrompt(
      {
        instructions: ["Always prefer actionable findings.", "docs/style.md", "docs/*"],
      },
      dir,
    );
    expect(loaded.error).toBeUndefined();
    expect(loaded.system).toContain("# Custom instructions");
    expect(loaded.system).toContain("Always prefer actionable findings.");
    expect(loaded.system).toContain("Use short sentences.");
    expect(loaded.system).toContain("Cite tests.");
    expect(loaded.system).not.toContain("skip.json");
  });

  test("errors on missing exact file path", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-instr-"));
    const loaded = await loadInstructionsPrompt({ instructions: ["missing/guide.md"] }, dir);
    expect(loaded.error).toContain("not found");
    expect(loaded.system).toBe("");
  });

  test("warns when glob matches nothing", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-instr-"));
    const loaded = await loadInstructionsPrompt({ instructions: ["nowhere/**/*.md"] }, dir);
    expect(loaded.error).toBeUndefined();
    expect(loaded.system).toBe("");
    expect(loaded.diagnostics.some((d) => d.level === "warning")).toBe(true);
  });
});
