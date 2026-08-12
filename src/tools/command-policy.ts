export type CommandPolicyResult = { ok: true } | { ok: false; reason: string };

export type InspectCommandPolicy = {
  /** Allow read-only git subcommands (commit-message agent). Default denies all git. */
  allowReadonlyGit?: boolean;
};

const READONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "blame",
  "rev-parse",
  "shortlog",
  "ls-files",
  "ls-tree",
  "cat-file",
  "describe",
  "name-rev",
  "rev-list",
]);

const GIT_PATTERNS: RegExp[] = [
  /(?:^|[\s;|&`(])git(?:\s|$)/i,
  /(?:^|[\s;|&`(])git-[a-z0-9_-]+(?:\s|$)/i,
  /\$\(\s*git(?:\s|\)|$)/i,
  /`[^`]*\bgit\b/i,
  /(?:^|[\s;|&])GIT_[A-Z_]+=\S*\s+git(?:\s|$)/i,
];

const WRITE_REDIRECT = /(?:^|[^0-9])>{1,2}\s*(?!&)/;

const DENY_COMMANDS = [
  "rm",
  "mv",
  "cp",
  "chmod",
  "chown",
  "mkdir",
  "touch",
  "tee",
  "dd",
  "truncate",
  "mkfs",
  "shred",
  "unlink",
  "ln",
  "install",
  "rsync",
];

const DENY_PACKAGE_MUTATORS: RegExp[] = [
  /\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|uninstall|update|i)\b/i,
  /\bbun\s+(?:add|remove|install|update|link)\b/i,
  /\bpip(?:3)?\s+install\b/i,
  /\bcargo\s+(?:install|add)\b/i,
];

const DENY_INPLACE_EDIT: RegExp[] = [
  /\bsed\s+[^\n]*-i\b/,
  /\bperl\s+[^\n]*-i\b/,
  /\bruby\s+[^\n]*-i\b/,
];

/**
 * Strip quoting and backslash escapes so `\git` and `gi"t"` compare as `git`.
 * Applied to tokens and to a collapsed copy of the full command for policy checks.
 */
function collapseShellEscapes(text: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!ch) continue;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else out += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i++;
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) {
      out += text[i + 1];
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Split on shell chain operators outside simple quotes (best-effort). */
function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (!ch) continue;
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";" || ch === "\n") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }
    if ((ch === "|" || ch === "&") && command[i + 1] === ch) {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i++;
      continue;
    }
    if (ch === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments.length > 0 ? segments : [command.trim()];
}

function stripSimpleEnvAssignments(segment: string): string {
  return segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)+/, "");
}

function firstToken(segment: string): string {
  const withoutEnv = stripSimpleEnvAssignments(segment.trim());
  const match = withoutEnv.match(/^([^\s]+)/);
  return collapseShellEscapes(match?.[1] ?? "");
}

function basenameCommand(token: string): string {
  const parts = token.split("/");
  return (parts[parts.length - 1] ?? token).toLowerCase();
}

function commandMentionsGit(command: string): boolean {
  for (const re of GIT_PATTERNS) {
    if (re.test(command)) return true;
  }
  for (const segment of splitShellSegments(command)) {
    const base = basenameCommand(firstToken(segment));
    if (base === "git" || base.startsWith("git-")) return true;
  }
  return false;
}

function tokenize(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function gitSubcommandsFromSegment(segment: string): string[] {
  const tokens = tokenize(stripSimpleEnvAssignments(segment));
  const found: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const base = basenameCommand(collapseShellEscapes(tokens[i] ?? ""));
    if (base.startsWith("git-") && base.length > 4) {
      found.push(base.slice(4));
      continue;
    }
    if (base !== "git") continue;
    i += 1;
    while (i < tokens.length) {
      const token = collapseShellEscapes(tokens[i] ?? "");
      if (token.startsWith("-")) {
        if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      found.push(token.toLowerCase());
      break;
    }
  }
  return found;
}

function collectGitSubcommands(command: string): string[] {
  const found: string[] = [];
  for (const segment of splitShellSegments(command)) {
    found.push(...gitSubcommandsFromSegment(segment));
  }
  const re =
    /\bgit(?:\s+(?:-C\s+\S+|--git-dir=\S+|--work-tree=\S+|--no-pager|-c\s+\S+|-[a-zA-Z]|--[a-zA-Z0-9-]+(?:=\S+)?))*\s+([a-z][a-z0-9-]*)/gi;
  for (const match of command.matchAll(re)) {
    const sub = match[1]?.toLowerCase();
    if (sub !== undefined) found.push(sub);
  }
  return found;
}

function denyGit(
  command: string,
  collapsed: string,
  allowReadonlyGit: boolean,
): string | undefined {
  if (!commandMentionsGit(command) && !commandMentionsGit(collapsed)) {
    return undefined;
  }
  if (!allowReadonlyGit) {
    return "git commands are not allowed; use host-provided diff context and inspectBash for file inspection";
  }
  const subcommands = [...collectGitSubcommands(command), ...collectGitSubcommands(collapsed)];
  if (subcommands.length === 0) {
    return "git commands require a read-only subcommand (status, log, diff, show, …)";
  }
  for (const sub of subcommands) {
    if (!READONLY_GIT_SUBCOMMANDS.has(sub)) {
      return `git ${sub} is not allowed (read-only git only)`;
    }
  }
  return undefined;
}

function denyWrites(command: string, collapsed: string): string | undefined {
  if (WRITE_REDIRECT.test(command)) {
    return "shell redirects that write files are not allowed (inspect-only)";
  }
  for (const re of DENY_INPLACE_EDIT) {
    if (re.test(command) || re.test(collapsed)) {
      return "in-place file edits are not allowed (inspect-only)";
    }
  }
  for (const re of DENY_PACKAGE_MUTATORS) {
    if (re.test(command) || re.test(collapsed)) {
      return "package install/mutation commands are not allowed (inspect-only)";
    }
  }
  for (const segment of splitShellSegments(collapsed)) {
    const base = basenameCommand(firstToken(segment));
    if (DENY_COMMANDS.includes(base)) {
      return `command "${base}" is not allowed (inspect-only)`;
    }
  }
  return undefined;
}

/**
 * Policy for agent inspectBash: block write/destructive mutations.
 * Git is denied unless `allowReadonlyGit` (read-only subcommands only).
 */
export function assertInspectCommandAllowed(
  command: string,
  policy: InspectCommandPolicy = {},
): CommandPolicyResult {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "command must be non-empty" };
  }
  const collapsed = collapseShellEscapes(trimmed);
  const gitReason = denyGit(trimmed, collapsed, policy.allowReadonlyGit === true);
  if (gitReason !== undefined) return { ok: false, reason: gitReason };
  const writeReason = denyWrites(trimmed, collapsed);
  if (writeReason !== undefined) return { ok: false, reason: writeReason };
  return { ok: true };
}
