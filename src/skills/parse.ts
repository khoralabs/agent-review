import { parse as parseYaml } from "yaml";

import type { SkillDiagnostic, SkillFrontmatter, SkillRecord } from "./types.ts";
import { parentDirName, validateSkillFrontmatter } from "./validate.ts";

export type ParseSkillOptions = {
  strict?: boolean;
};

export type ParseSkillResult =
  | { ok: true; skill: SkillRecord; diagnostics: SkillDiagnostic[] }
  | { ok: false; diagnostics: SkillDiagnostic[] };

function asStringMap(value: unknown): Record<string, string> | undefined {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") out[key] = raw;
    else if (raw !== undefined && raw !== null) out[key] = String(raw);
  }
  return out;
}

function extractFrontmatter(text: string): { yaml: string; body: string } | undefined {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) return undefined;
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return undefined;
  return { yaml: match[1] ?? "", body: (match[2] ?? "").trim() };
}

export function parseSkillMarkdown(
  text: string,
  skillMdPath: string,
  options: ParseSkillOptions = {},
): ParseSkillResult {
  const extracted = extractFrontmatter(text);
  if (!extracted) {
    return {
      ok: false,
      diagnostics: [
        {
          level: "error",
          path: skillMdPath,
          message: "SKILL.md must start with YAML frontmatter delimited by ---",
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(extracted.yaml);
  } catch (err) {
    return {
      ok: false,
      diagnostics: [
        {
          level: "error",
          path: skillMdPath,
          message: `invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      diagnostics: [
        {
          level: "error",
          path: skillMdPath,
          message: "frontmatter must be a YAML mapping",
        },
      ],
    };
  }

  const raw = parsed as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const dirName = parentDirName(skillMdPath);

  const frontmatter: SkillFrontmatter = {
    name,
    description,
  };

  if (typeof raw.license === "string" && raw.license.trim().length > 0) {
    frontmatter.license = raw.license.trim();
  }
  if (typeof raw.compatibility === "string" && raw.compatibility.trim().length > 0) {
    frontmatter.compatibility = raw.compatibility.trim();
  }
  const metadata = asStringMap(raw.metadata);
  if (metadata !== undefined) frontmatter.metadata = metadata;
  const allowedTools = raw["allowed-tools"];
  if (typeof allowedTools === "string" && allowedTools.trim().length > 0) {
    frontmatter.allowedTools = allowedTools.trim();
  }

  const diagnostics = validateSkillFrontmatter(frontmatter, dirName, skillMdPath, options);
  const hasError = diagnostics.some((d) => d.level === "error");
  if (hasError || name.length === 0 || description.length === 0) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    skill: {
      name: frontmatter.name,
      description: frontmatter.description,
      body: extracted.body,
      location: skillMdPath,
      dirName,
      frontmatter,
    },
    diagnostics,
  };
}
