import fs from "node:fs";
import path from "node:path";

import type { AgentReviewConfig } from "../config.ts";

export type InstructionDiagnostic = {
  level: "error" | "warning";
  entry: string;
  message: string;
};

export type LoadInstructionsPromptResult = {
  system: string;
  diagnostics: InstructionDiagnostic[];
  error?: string;
};

const INSTRUCTION_EXT = /\.(md|txt)$/i;

function looksLikePathOrGlob(entry: string): boolean {
  return /[/\\*?[\]]/.test(entry) || INSTRUCTION_EXT.test(entry);
}

function isGlobPattern(entry: string): boolean {
  return /[*?[\]]/.test(entry);
}

function isInstructionFile(filePath: string): boolean {
  return INSTRUCTION_EXT.test(filePath);
}

function toRepoRelative(cwd: string, absolutePath: string): string {
  const rel = path.relative(cwd, absolutePath);
  return rel.length > 0 ? rel.split(path.sep).join("/") : path.basename(absolutePath);
}

/** Prefer literal text when the entry is not a path/glob and does not exist on disk. */
export function isLiteralInstruction(entry: string, cwd: string): boolean {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return false;
  if (looksLikePathOrGlob(trimmed)) return false;
  if (fs.existsSync(path.resolve(cwd, trimmed))) return false;
  return true;
}

async function expandGlob(cwd: string, pattern: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for await (const match of glob.scan({ cwd, onlyFiles: true, dot: true })) {
    if (!isInstructionFile(match)) continue;
    matches.push(path.resolve(cwd, match));
  }
  matches.sort((a, b) => a.localeCompare(b));
  return matches;
}

function formatInstructionsSystem(parts: Array<{ heading: string; body: string }>): string {
  if (parts.length === 0) return "";
  const blocks = parts.map((p) => `## ${p.heading}\n\n${p.body.trim()}`);
  return ["# Custom instructions", ...blocks].join("\n\n");
}

/**
 * Resolve config `instructions`: literal strings and/or Bun.Glob paths to `.md`/`.txt`.
 */
export async function loadInstructionsPrompt(
  config: Pick<AgentReviewConfig, "instructions">,
  cwd: string,
): Promise<LoadInstructionsPromptResult> {
  const diagnostics: InstructionDiagnostic[] = [];
  const parts: Array<{ heading: string; body: string }> = [];
  const seenFiles = new Set<string>();

  for (const raw of config.instructions) {
    if (typeof raw !== "string") continue;
    const entry = raw.trim();
    if (entry.length === 0) continue;

    if (isLiteralInstruction(entry, cwd)) {
      parts.push({ heading: "(literal)", body: entry });
      continue;
    }

    if (isGlobPattern(entry)) {
      const files = await expandGlob(cwd, entry);
      if (files.length === 0) {
        diagnostics.push({
          level: "warning",
          entry,
          message: "glob matched no .md/.txt files",
        });
        continue;
      }
      for (const abs of files) {
        if (seenFiles.has(abs)) continue;
        seenFiles.add(abs);
        parts.push({
          heading: toRepoRelative(cwd, abs),
          body: fs.readFileSync(abs, "utf8"),
        });
      }
      continue;
    }

    const abs = path.resolve(cwd, entry);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      diagnostics.push({
        level: "error",
        entry,
        message: `instruction file not found: ${entry}`,
      });
      continue;
    }
    if (!isInstructionFile(abs)) {
      diagnostics.push({
        level: "error",
        entry,
        message: "instruction files must end in .md or .txt",
      });
      continue;
    }
    if (seenFiles.has(abs)) continue;
    seenFiles.add(abs);
    parts.push({
      heading: toRepoRelative(cwd, abs),
      body: fs.readFileSync(abs, "utf8"),
    });
  }

  const errors = diagnostics.filter((d) => d.level === "error");
  if (errors.length > 0) {
    return {
      system: "",
      diagnostics,
      error: errors.map((d) => `${d.entry}: ${d.message}`).join("\n"),
    };
  }

  return {
    system: formatInstructionsSystem(parts),
    diagnostics,
  };
}

/** Join non-empty system prompt sections. */
export function joinSystemParts(...parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join("\n\n");
}
