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
import {
  appendWorkstreamWorkLog,
  doneWorkstream,
  linkReviewToWorkstream,
  resolveWorkstreamIdOrActive,
  resumeWorkstream,
  startWorkstream,
} from "./lib/workstreams.ts";
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
  workstream     Opt-in workstream catalog (start|resume|link|log|done)
  migrate        Convert legacy runs/ + remediations/ into reviews/<runId>/
  commit-message Draft a Conventional Commits message for the current diff

Workstream subcommands:
  workstream start [--title …] [--message …]
  workstream resume <workstreamId>
  workstream link <runId> [--workstream-id <id>]
  workstream log --event … --message … [--workstream-id <id>]
  workstream done [--workstream-id <id>] [--message …]

Options:
  --force                   init: overwrite existing config/hook/skill
  --run-id <id>             analyze / status (status defaults to latest)
  --remediation <id|path>   required for log (<runId>/<index> or reviews/…)
  --workstream-id <id>      workstream link/log/done; also run/review auto-link override
  --title <text>            workstream start: optional title
  --event <name>            log / workstream log: started|note|artifact|status|done
  --message <text>          log / workstream: entry message (review: commit message)
  --path <rel>              log: artifact path relative to remediation/workstream dir
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
  workstreamAutoLink  when true (default) and active-workstream is set, symlink new reviews
  skip    true → exit 0 for run/review/analyze/walk (not status/log/migrate/commit-message/init/workstream)
          Prefer SKIP_AGENT_REVIEW=1 for local bypass so skip is not committed.

Artifacts (repo-root-relative paths):
  <output-dir>/reviews/<YYYYMMDDTHHMMSSZ>-<shortSha>/run.json
  <output-dir>/reviews/<YYYYMMDDTHHMMSSZ>-<shortSha>/diff.gz
  <output-dir>/reviews/<runId>/remediations/<index>/plan.md
  <output-dir>/reviews/<runId>/remediations/<index>/work-log.jsonl
  <output-dir>/workstreams/<id>/{chunks.json,adr.md,todo.md,work-log.jsonl,commits/}
  <output-dir>/workstreams.jsonl
  <output-dir>/active-workstream
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
  if (overrides.workstreamId !== undefined) {
    argv.push("--workstream-id", overrides.workstreamId);
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

async function revParseShort(cwd: string, rev: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", "--short", rev], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return undefined;
  const short = stdout.trim();
  return short.length > 0 ? short : undefined;
}

async function revParseFull(cwd: string, rev: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", rev], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return undefined;
  const full = stdout.trim();
  return full.length > 0 ? full : undefined;
}

async function runWorkstreamCommand(
  overrides: ParsedCliArgs,
  config: AgentReviewConfig,
  cwd: string,
): Promise<number> {
  const sub = overrides.workstreamSubcommand;
  if (sub === undefined) {
    console.error("workstream requires a subcommand: start|resume|link|log|done");
    return 2;
  }

  try {
    if (sub === "start") {
      const shortSha = (await revParseShort(cwd, "HEAD")) ?? "unknown";
      const gitHead = await revParseFull(cwd, "HEAD");
      const started = startWorkstream({
        cwd,
        outputDir: config.outputDir,
        shortSha,
        ...(gitHead !== undefined ? { gitHead } : {}),
        ...(overrides.title !== undefined ? { title: overrides.title } : {}),
      });
      if (overrides.message !== undefined && overrides.message.trim().length > 0) {
        appendWorkstreamWorkLog({
          cwd,
          outputDir: config.outputDir,
          workstreamId: started.workstreamId,
          entry: {
            event: "started",
            message: overrides.message.trim(),
            status: "in_progress",
            ...(overrides.agent !== undefined ? { agent: overrides.agent } : {}),
          },
        });
      }
      console.error(`agent-review: workstream started ${started.relativeDir}`);
      console.log(started.workstreamId);
      return 0;
    }

    if (sub === "resume") {
      const id = overrides.workstreamId?.trim();
      if (id === undefined || id.length === 0) {
        console.error("workstream resume requires <workstreamId>");
        return 2;
      }
      const resumed = resumeWorkstream({
        cwd,
        outputDir: config.outputDir,
        workstreamId: id,
      });
      console.error(`agent-review: workstream resumed ${resumed.relativeDir}`);
      console.log(resumed.workstreamId);
      return 0;
    }

    if (sub === "done") {
      const result = doneWorkstream({
        cwd,
        outputDir: config.outputDir,
        workstreamId: overrides.workstreamId,
        message: overrides.message,
        agent: overrides.agent,
      });
      console.error(
        `agent-review: workstream done ${result.workstreamId}${result.clearedActive ? " (cleared active)" : ""}`,
      );
      console.log(result.workstreamId);
      return 0;
    }

    if (sub === "link") {
      const runId = overrides.linkRunId?.trim() || overrides.runId?.trim();
      if (runId === undefined || runId.length === 0) {
        console.error("workstream link requires <runId>");
        return 2;
      }
      const workstreamId = resolveWorkstreamIdOrActive({
        cwd,
        outputDir: config.outputDir,
        workstreamId: overrides.workstreamId,
      });
      const linked = linkReviewToWorkstream({
        cwd,
        outputDir: config.outputDir,
        workstreamId,
        runId,
      });
      console.error(
        `agent-review: workstream link ${linked.created ? "created" : "exists"} ${linked.relativeLinkPath}`,
      );
      console.log(linked.relativeLinkPath);
      return 0;
    }

    // log
    const eventRaw = overrides.event?.trim();
    if (eventRaw === undefined || eventRaw.length === 0) {
      console.error("workstream log requires --event");
      return 2;
    }
    const message = overrides.message?.trim();
    if (message === undefined || message.length === 0) {
      console.error("workstream log requires --message");
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
    const workstreamId = resolveWorkstreamIdOrActive({
      cwd,
      outputDir: config.outputDir,
      workstreamId: overrides.workstreamId,
    });
    const written = appendWorkstreamWorkLog({
      cwd,
      outputDir: config.outputDir,
      workstreamId,
      entry: {
        event: eventParsed.data,
        message,
        ...(overrides.path !== undefined ? { artifact: overrides.path } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(overrides.agent !== undefined ? { agent: overrides.agent } : {}),
      },
    });
    console.error(`agent-review: workstream logged ${written.entry.event}`);
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

  // Exempt from skip: log / migrate / commit-message / status / init / workstream
  if (
    config.skip &&
    overrides.command !== "log" &&
    overrides.command !== "migrate" &&
    overrides.command !== "commit-message" &&
    overrides.command !== "status" &&
    overrides.command !== "init" &&
    overrides.command !== "workstream"
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

  if (overrides.command === "workstream") {
    if (overrides.noEmit === true) {
      console.error("workstream cannot be used with --no-emit");
      return 2;
    }
    return runWorkstreamCommand(overrides, config, cwd);
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
      workstreamId: overrides.workstreamId,
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
    workstreamId: overrides.workstreamId,
  });
  console.error(outcome.message);
  return outcome.exitCode;
}

if (import.meta.main) {
  process.exit(await main());
}
