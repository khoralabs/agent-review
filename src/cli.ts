import { type AgentReviewConfig, type ParsedCliArgs, parseArgs, resolveConfig } from "./config.ts";
import { runInit } from "./lib/init.ts";
import { migrateAgentReviewLayout } from "./lib/migrate-layout.ts";
import { resolveOutputDir } from "./lib/observability.ts";
import {
  appendWorkLog,
  type WorkLogEntryInput,
  workLogEventSchema,
  workLogStatusSchema,
} from "./lib/work-log.ts";
import { runAnalyzePhase } from "./pipeline/analyze-phase.ts";
import { runCommitMessagePhase } from "./pipeline/commit-message-phase.ts";
import { orchestrateInProcess, orchestrateViaCli } from "./pipeline/orchestrate.ts";
import { runReviewPhase } from "./pipeline/review-phase.ts";
import { runStatusPhase } from "./pipeline/status-phase.ts";
import { runWalkPhase } from "./pipeline/walk-phase.ts";

function printHelp(): void {
  console.log(`Usage: agent-review <command> [options]

Commands:
  init           Scaffold .agent-review.json, husky commit-msg, and operator skill
  run            Orchestrate review then analyze (default; used by hooks)
  review         Collect diff + review agent; print runId on stdout
  analyze        Triage findings for --run-id <id> from a prior review
  status         Show blocking remediations for a run (default: latest; no LLM)
  walk           Review each commit in from..to; catalog + dedupe findings
  log            Append a JSONL work-log entry under a remediation directory
  migrate        Convert legacy runs/ + remediations/ into reviews/<runId>/
  commit-message Draft a Conventional Commits message for the current diff

Options:
  --force                   init: overwrite existing config/hook/skill
  --run-id <id>             analyze / status (status defaults to latest)
  --remediation <id|path>   required for log (<runId>/<index> or reviews/…)
  --event <name>            log: started|note|artifact|status|done
  --message <text>          log: entry message (review: commit message)
  --path <rel>              log: artifact path relative to remediation dir
  --status <name>           log: proposed|in_progress|blocked|done
  --agent <label>           log: optional agent/caller label
  --min-severity <level>    status: error|warning|info (default: config blockOn)
  --json                    status / walk: machine-readable report
  --from <rev>              walk: exclusive start (required)
  --to <rev>                walk: inclusive end (default HEAD)
  --concurrency <n>         walk: parallel commit reviews (default analystConcurrency)
  --max-commits <n>         walk: cap commits after rev-list
  --keep-worktree           walk: leave detached worktrees under output-dir
  --scope staged|unstaged|working|range|commit|stdin
  --commit <rev>            review a single commit (default HEAD); implies --scope commit
  --message-file <path>     read commit message from file (commit-msg hook $1)
  --base <ref>              required for --scope range
  --head <ref>              default HEAD for range
  --skills path,path        skill dirs to activate (tier 2; default: packaged code-review)
  --skills-dirs path,path   discovery roots for catalog (tier 1)
  --model <gateway-id>      override all agents for this invocation
  --output-dir <path>       default .data/agent-review (use a separate dir for walk)
  --analyst-concurrency <n> max parallel analyst sessions (default 4)
  --include-workstream      attach prior same-HEAD review/remediation context
  --no-emit                 skip writing pipeline data to disk
  --config <path>           default .agent-review.json
  -h, --help

Env:
  AI_GATEWAY_API_KEY     required for run/review/analyze/commit-message/walk
  AGENT_REVIEW_MODEL     optional; override all agent models for this process
  SKIP_AGENT_REVIEW=1    optional; skip run/review/analyze/walk (overrides config.skip)

Config (.agent-review.json):
  model   string for all agents, or { review, analyze, commitMessage }
  skip    true → exit 0 for run/review/analyze/walk (not status/log/migrate/commit-message/init)
          Prefer SKIP_AGENT_REVIEW=1 for local bypass so skip is not committed.

Artifacts (repo-root-relative paths):
  <output-dir>/reviews/<YYYYMMDDTHHMMSSZ>-<shortSha>/run.json
  <output-dir>/reviews/<YYYYMMDDTHHMMSSZ>-<shortSha>/diff.gz
  <output-dir>/reviews/<runId>/remediations/<index>/plan.md
  <output-dir>/reviews/<runId>/remediations/<index>/work-log.jsonl
  <output-dir>/walks/<walkId>/walk.json
  <output-dir>/walks/<walkId>/catalog.json
  <output-dir>/walks/<walkId>/summary.md
  <output-dir>/walks.jsonl
  <output-dir>/reviews.jsonl
  <output-dir>/findings.jsonl
  <output-dir>/agents/<staticHash>.json.gz
  <output-dir>/telemetry.jsonl
`);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function resolveRepoRoot(cwd: string = process.cwd()): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return cwd;
  const root = stdout.trim();
  return root.length > 0 ? root : cwd;
}

function flagArgvFromOverrides(overrides: ParsedCliArgs): string[] {
  const argv: string[] = [];
  if (overrides.configPath !== undefined) {
    argv.push("--config", overrides.configPath);
  }
  if (overrides.scope !== undefined) argv.push("--scope", overrides.scope);
  if (overrides.base !== undefined) argv.push("--base", overrides.base);
  if (overrides.head !== undefined) argv.push("--head", overrides.head);
  if (overrides.commit !== undefined) argv.push("--commit", overrides.commit);
  if (overrides.commitMessage !== undefined) {
    argv.push("--message", overrides.commitMessage);
  }
  if (overrides.commitMessageFile !== undefined) {
    argv.push("--message-file", overrides.commitMessageFile);
  }
  if (overrides.model !== undefined) argv.push("--model", overrides.model);
  if (overrides.outputDir !== undefined) {
    argv.push("--output-dir", overrides.outputDir);
  }
  if (overrides.analystConcurrency !== undefined) {
    argv.push("--analyst-concurrency", String(overrides.analystConcurrency));
  }
  if (overrides.includeWorkstream === true) {
    argv.push("--include-workstream");
  }
  if (overrides.noEmit === true) {
    argv.push("--no-emit");
  }
  if (overrides.skills !== undefined) {
    argv.push("--skills", overrides.skills.join(","));
  }
  if (overrides.skillsDirs !== undefined) {
    argv.push("--skills-dirs", overrides.skillsDirs.join(","));
  }
  return argv;
}

function runLogCommand(overrides: ParsedCliArgs, config: AgentReviewConfig, cwd: string): number {
  const remediation = overrides.remediation?.trim();
  if (remediation === undefined || remediation.length === 0) {
    console.error("log requires --remediation");
    return 2;
  }
  const eventRaw = overrides.event?.trim();
  if (eventRaw === undefined || eventRaw.length === 0) {
    console.error("log requires --event");
    return 2;
  }
  const message = overrides.message?.trim();
  if (message === undefined || message.length === 0) {
    console.error("log requires --message");
    return 2;
  }

  const eventParsed = workLogEventSchema.safeParse(eventRaw);
  if (!eventParsed.success) {
    console.error(`--event must be one of: ${workLogEventSchema.options.join("|")}`);
    return 2;
  }

  let status: WorkLogEntryInput["status"];
  if (overrides.status !== undefined) {
    const statusParsed = workLogStatusSchema.safeParse(overrides.status.trim());
    if (!statusParsed.success) {
      console.error(`--status must be one of: ${workLogStatusSchema.options.join("|")}`);
      return 2;
    }
    status = statusParsed.data;
  }

  const entry: WorkLogEntryInput = {
    event: eventParsed.data,
    message,
    ...(overrides.path !== undefined ? { artifact: overrides.path } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(overrides.agent !== undefined ? { agent: overrides.agent } : {}),
  };

  try {
    const written = appendWorkLog({
      cwd,
      outputDir: config.outputDir,
      remediation,
      entry,
    });
    console.error(`agent-review: logged ${written.entry.event}`);
    console.log(written.relativeWorkLogPath);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let overrides: ParsedCliArgs;
  try {
    overrides = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  if (overrides.help) {
    printHelp();
    return 0;
  }

  const cwd = overrides.cwd ?? (await resolveRepoRoot());

  let config: AgentReviewConfig;
  try {
    config = resolveConfig({ ...overrides, cwd });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  // `log` / `migrate` / `commit-message` / `status` / `init` are exempt (skip is for review pipeline).
  if (
    config.skip &&
    overrides.command !== "log" &&
    overrides.command !== "migrate" &&
    overrides.command !== "commit-message" &&
    overrides.command !== "status" &&
    overrides.command !== "init"
  ) {
    const via =
      process.env.SKIP_AGENT_REVIEW?.trim() === "1" ? "SKIP_AGENT_REVIEW=1" : "config.skip=true";
    console.error(`agent-review: skipped (${via})`);
    return 0;
  }

  if (overrides.command === "init") {
    try {
      const result = runInit({ cwd, force: overrides.force === true });
      for (const line of result.messages) {
        console.error(line.length > 0 ? `agent-review: init: ${line}` : "");
      }
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  if (overrides.command === "log") {
    if (overrides.noEmit === true) {
      console.error("log cannot be used with --no-emit");
      return 2;
    }
    return runLogCommand(overrides, config, cwd);
  }

  if (overrides.command === "migrate") {
    if (overrides.noEmit === true) {
      console.error("migrate cannot be used with --no-emit");
      return 2;
    }
    try {
      const outputDir = resolveOutputDir(cwd, config.outputDir);
      const result = migrateAgentReviewLayout({ cwd, outputDir });
      if (result.alreadyMigrated) {
        console.error("agent-review: migrate: already on reviews/ layout");
      } else {
        console.error(
          `agent-review: migrate: runs=${result.migratedRuns.length} remediations=${result.migratedRemediations.length}`,
        );
      }
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  if (overrides.command === "status") {
    const outcome = await runStatusPhase({
      config,
      cwd,
      runId: overrides.runId,
      minSeverity: overrides.minSeverity,
      json: overrides.json === true,
    });
    if (outcome.exitCode === 2) {
      console.error(outcome.message);
    } else {
      console.log(outcome.message);
    }
    return outcome.exitCode;
  }

  if (overrides.command === "run") {
    if (overrides.noEmit === true) {
      const scope = overrides.scope ?? config.defaultScope;
      const stdinText = scope === "stdin" ? await readStdin() : undefined;
      const outcome = await orchestrateInProcess({
        config,
        scope,
        base: overrides.base,
        head: overrides.head,
        commit: overrides.commit,
        cwd,
        stdinText,
        commitMessage: overrides.commitMessage,
        commitMessageFile: overrides.commitMessageFile,
        quiet: false,
      });
      console.error(outcome.review.message);
      if (outcome.analyze !== undefined) {
        console.error(outcome.analyze.message);
      }
      return outcome.exitCode;
    }
    const outcome = await orchestrateViaCli({
      argv: flagArgvFromOverrides(overrides),
      cwd,
      outputDir: config.outputDir,
    });
    if (
      outcome.message.includes("orchestrator:") ||
      outcome.message.includes("analyze skipped") ||
      (outcome.exitCode !== 0 && outcome.message === "review failed")
    ) {
      console.error(outcome.message);
    }
    return outcome.exitCode;
  }

  if (overrides.command === "commit-message") {
    const scope = overrides.scope ?? config.defaultScope;
    const stdinText = scope === "stdin" ? await readStdin() : undefined;
    const outcome = await runCommitMessagePhase({
      config,
      scope,
      base: overrides.base,
      head: overrides.head,
      commit: overrides.commit,
      cwd,
      stdinText,
      skipArtifacts: overrides.noEmit === true,
    });
    if (outcome.exitCode === 0 && outcome.commitMessage !== undefined) {
      console.log(outcome.commitMessage);
    } else {
      console.error(outcome.message);
    }
    return outcome.exitCode;
  }

  if (overrides.command === "walk") {
    const from = overrides.from?.trim();
    if (from === undefined || from.length === 0) {
      console.error("walk requires --from");
      return 2;
    }
    const outcome = await runWalkPhase({
      config,
      from,
      to: overrides.to,
      cwd,
      concurrency: overrides.concurrency,
      maxCommits: overrides.maxCommits,
      keepWorktree: overrides.keepWorktree === true,
      skipArtifacts: overrides.noEmit === true,
      json: overrides.json === true,
    });
    console.error(outcome.message);
    if (outcome.walkIdStdout !== undefined) {
      console.log(outcome.walkIdStdout);
    }
    return outcome.exitCode;
  }

  if (overrides.command === "review") {
    const scope = overrides.scope ?? config.defaultScope;
    const stdinText = scope === "stdin" ? await readStdin() : undefined;
    const outcome = await runReviewPhase({
      config,
      scope,
      base: overrides.base,
      head: overrides.head,
      commit: overrides.commit,
      cwd,
      stdinText,
      commitMessage: overrides.commitMessage,
      commitMessageFile: overrides.commitMessageFile,
      skipArtifacts: overrides.noEmit === true,
      quiet: overrides.noEmit === true ? false : undefined,
    });
    console.error(outcome.message);
    if (outcome.runIdStdout !== undefined) {
      console.log(outcome.runIdStdout);
    }
    return outcome.exitCode;
  }

  // analyze
  const runId = overrides.runId?.trim();
  if (runId === undefined || runId.length === 0) {
    console.error("analyze requires --run-id");
    return 2;
  }
  const outcome = await runAnalyzePhase({
    config,
    runId,
    cwd,
    commitMessage: overrides.commitMessage,
    skipArtifacts: overrides.noEmit === true,
    quiet: overrides.noEmit === true ? false : undefined,
  });
  console.error(outcome.message);
  return outcome.exitCode;
}

if (import.meta.main) {
  process.exit(await main());
}
