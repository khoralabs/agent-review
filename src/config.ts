import fs from "node:fs";
import path from "node:path";
import type { DiffScope } from "./lib/git.ts";
import { DEFAULT_OUTPUT_DIR } from "./lib/observability.ts";
import type { FindingSeverity } from "./schema/index.ts";

export type AgentReviewConfig = {
  model: string;
  skills: string[];
  skillsDirs: string[];
  blockOn: FindingSeverity[];
  maxDiffBytes: number;
  defaultScope: DiffScope;
  outputDir: string;
  /** Max concurrent analyst triage sessions (FIFO pool). */
  analystConcurrency: number;
  /** Attach same-HEAD prior runs as prompt context (default off). */
  includeWorkstream: boolean;
};

export const DEFAULT_CONFIG: AgentReviewConfig = {
  model: "google/gemini-3.5-flash",
  skills: ["./skills/agent-review/code-review"],
  skillsDirs: [".agents/skills"],
  blockOn: ["error"],
  maxDiffBytes: 200_000,
  defaultScope: "staged",
  outputDir: DEFAULT_OUTPUT_DIR,
  analystConcurrency: 4,
  includeWorkstream: false,
};

const SCOPES = new Set<DiffScope>(["staged", "unstaged", "working", "range", "commit", "stdin"]);
const SEVERITIES = new Set<FindingSeverity>(["error", "warning", "info"]);

export type CliCommand =
  | "run"
  | "review"
  | "analyze"
  | "log"
  | "migrate"
  | "commit-message"
  | "status"
  | "walk";

export type CliOverrides = {
  configPath?: string;
  scope?: DiffScope;
  base?: string;
  head?: string;
  commit?: string;
  skills?: string[];
  skillsDirs?: string[];
  model?: string;
  outputDir?: string;
  cwd?: string;
  commitMessage?: string;
  commitMessageFile?: string;
  runId?: string;
  remediation?: string;
  event?: string;
  message?: string;
  path?: string;
  status?: string;
  agent?: string;
  analystConcurrency?: number;
  includeWorkstream?: boolean;
  /** Skip writing pipeline artifacts (CLI-only). */
  noEmit?: boolean;
  /** status: least severe severity to treat as blocking. */
  minSeverity?: FindingSeverity;
  /** status / walk: print JSON. */
  json?: boolean;
  /** walk: exclusive start revision. */
  from?: string;
  /** walk: inclusive end revision (default HEAD). */
  to?: string;
  /** walk: max parallel commit reviews. */
  concurrency?: number;
  /** walk: cap number of commits after rev-list. */
  maxCommits?: number;
  /** walk: leave detached worktrees after finish. */
  keepWorktree?: boolean;
};

export type ParsedCliArgs = CliOverrides & {
  help?: boolean;
  command: CliCommand;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseScope(value: unknown, label: string): DiffScope {
  if (typeof value !== "string" || !SCOPES.has(value as DiffScope)) {
    throw new Error(`${label} must be one of: ${[...SCOPES].join(", ")}`);
  }
  return value as DiffScope;
}

function parseSeverity(value: string, label: string): FindingSeverity {
  if (!SEVERITIES.has(value as FindingSeverity)) {
    throw new Error(`${label} must be error|warning|info`);
  }
  return value as FindingSeverity;
}

function parseBlockOn(value: unknown): FindingSeverity[] {
  if (!Array.isArray(value)) throw new Error("blockOn must be an array");
  const out: FindingSeverity[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !SEVERITIES.has(item as FindingSeverity)) {
      throw new Error(`blockOn entries must be error|warning|info, got ${String(item)}`);
    }
    out.push(item as FindingSeverity);
  }
  return out;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of strings`);
  return value.map((item, i) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${label}[${i}] must be a non-empty string`);
    }
    return item.trim();
  });
}

function parsePositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export function loadConfigFile(configPath: string): Partial<AgentReviewConfig> {
  if (!fs.existsSync(configPath)) {
    throw new Error(`config file not found: ${configPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("config root must be an object");

  const partial: Partial<AgentReviewConfig> = {};
  if (raw.model !== undefined) {
    if (typeof raw.model !== "string" || raw.model.trim().length === 0) {
      throw new Error("model must be a non-empty string");
    }
    partial.model = raw.model.trim();
  }
  if (raw.skills !== undefined) partial.skills = parseStringArray(raw.skills, "skills");
  if (raw.skillsDirs !== undefined) {
    partial.skillsDirs = parseStringArray(raw.skillsDirs, "skillsDirs");
  }
  if (raw.blockOn !== undefined) partial.blockOn = parseBlockOn(raw.blockOn);
  if (raw.maxDiffBytes !== undefined) {
    if (
      typeof raw.maxDiffBytes !== "number" ||
      !Number.isFinite(raw.maxDiffBytes) ||
      raw.maxDiffBytes <= 0
    ) {
      throw new Error("maxDiffBytes must be a positive number");
    }
    partial.maxDiffBytes = raw.maxDiffBytes;
  }
  if (raw.defaultScope !== undefined) {
    partial.defaultScope = parseScope(raw.defaultScope, "defaultScope");
  }
  if (raw.outputDir !== undefined) {
    if (typeof raw.outputDir !== "string" || raw.outputDir.trim().length === 0) {
      throw new Error("outputDir must be a non-empty string");
    }
    partial.outputDir = raw.outputDir.trim();
  }
  if (raw.analystConcurrency !== undefined) {
    partial.analystConcurrency = parsePositiveInt(raw.analystConcurrency, "analystConcurrency");
  }
  if (raw.includeWorkstream !== undefined) {
    if (typeof raw.includeWorkstream !== "boolean") {
      throw new Error("includeWorkstream must be a boolean");
    }
    partial.includeWorkstream = raw.includeWorkstream;
  }
  return partial;
}

export function resolveConfig(overrides: CliOverrides = {}): AgentReviewConfig {
  const cwd = overrides.cwd ?? process.cwd();
  const configPath = overrides.configPath ?? path.join(cwd, ".agent-review.json");

  let filePartial: Partial<AgentReviewConfig> = {};
  if (fs.existsSync(configPath)) {
    filePartial = loadConfigFile(configPath);
  }

  const envModel = process.env.AGENT_REVIEW_MODEL?.trim();

  let scope = overrides.scope ?? filePartial.defaultScope ?? DEFAULT_CONFIG.defaultScope;
  // --commit without --scope implies commit scope
  if (overrides.commit !== undefined && overrides.scope === undefined) {
    scope = "commit";
  }

  return {
    model: overrides.model?.trim() || envModel || filePartial.model || DEFAULT_CONFIG.model,
    skills: overrides.skills ?? filePartial.skills ?? DEFAULT_CONFIG.skills,
    skillsDirs: overrides.skillsDirs ?? filePartial.skillsDirs ?? DEFAULT_CONFIG.skillsDirs,
    blockOn: filePartial.blockOn ?? DEFAULT_CONFIG.blockOn,
    maxDiffBytes: filePartial.maxDiffBytes ?? DEFAULT_CONFIG.maxDiffBytes,
    defaultScope: scope,
    outputDir: overrides.outputDir?.trim() || filePartial.outputDir || DEFAULT_CONFIG.outputDir,
    analystConcurrency:
      overrides.analystConcurrency ??
      filePartial.analystConcurrency ??
      DEFAULT_CONFIG.analystConcurrency,
    includeWorkstream:
      overrides.includeWorkstream ??
      filePartial.includeWorkstream ??
      DEFAULT_CONFIG.includeWorkstream,
  };
}

export function parseArgs(argv: string[]): ParsedCliArgs {
  const COMMANDS = new Set<CliCommand>([
    "run",
    "review",
    "analyze",
    "log",
    "migrate",
    "commit-message",
    "status",
    "walk",
  ]);
  let command: CliCommand = "run";
  let start = 0;
  const first = argv[0];
  if (first !== undefined && COMMANDS.has(first as CliCommand)) {
    command = first as CliCommand;
    start = 1;
  }

  const out: ParsedCliArgs = { command };
  for (let i = start; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    if (arg === "--config") out.configPath = next();
    else if (arg === "--scope") out.scope = parseScope(next(), "--scope");
    else if (arg === "--base") out.base = next();
    else if (arg === "--head") out.head = next();
    else if (arg === "--commit") out.commit = next();
    else if (arg === "--from") out.from = next();
    else if (arg === "--to") out.to = next();
    else if (arg === "--message") {
      // review: commit message; log: work-log message (disambiguated by command)
      if (command === "log") out.message = next();
      else out.commitMessage = next();
    } else if (arg === "--message-file") out.commitMessageFile = next();
    else if (arg === "--model") out.model = next();
    else if (arg === "--output-dir") out.outputDir = next();
    else if (arg === "--analyst-concurrency") {
      const raw = next();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--analyst-concurrency must be a positive integer");
      }
      out.analystConcurrency = n;
    } else if (arg === "--concurrency") {
      const raw = next();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--concurrency must be a positive integer");
      }
      out.concurrency = n;
    } else if (arg === "--max-commits") {
      const raw = next();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error("--max-commits must be a non-negative integer");
      }
      out.maxCommits = n;
    } else if (arg === "--keep-worktree") {
      out.keepWorktree = true;
    } else if (arg === "--include-workstream") {
      out.includeWorkstream = true;
    } else if (arg === "--no-emit") {
      out.noEmit = true;
    } else if (arg === "--run-id") out.runId = next();
    else if (arg === "--remediation") out.remediation = next();
    else if (arg === "--event") out.event = next();
    else if (arg === "--path") out.path = next();
    else if (arg === "--status") out.status = next();
    else if (arg === "--agent") out.agent = next();
    else if (arg === "--min-severity") {
      out.minSeverity = parseSeverity(next(), "--min-severity");
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--skills") {
      out.skills = next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--skills-dirs") {
      out.skillsDirs = next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}
