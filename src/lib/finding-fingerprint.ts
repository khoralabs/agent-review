import { createHash } from "node:crypto";

/** Normalize issue key for fingerprinting (case/format stable). */
export function normalizeFindingKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Normalize file path for fingerprinting (POSIX separators). */
export function normalizeFindingFile(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function normalizeFindingRule(rule: string | undefined): string {
  if (rule === undefined) return "";
  return rule.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Host identity for a finding across runs: key + file + rule (not message).
 */
export function findingFingerprint(input: { key: string; file: string; rule?: string }): string {
  const payload = [
    normalizeFindingKey(input.key),
    normalizeFindingFile(input.file),
    normalizeFindingRule(input.rule),
  ].join("\0");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
