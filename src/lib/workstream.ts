import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { loadRunArtifact, type ReviewRunArtifact } from "./artifacts.ts";
import { PLAN_FILENAME, reviewsRoot, runDir } from "./paths.ts";

const TOTAL_BUDGET = 24_000;
const DIFF_PER_RUN = 4_000;
const PLAN_EXCERPT = 1_200;
const ARTIFACT_EXCERPT = 600;

const SKIP_SHAS = new Set(["unknown", "stdin"]);

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

function warnWorkstream(context: string, err: unknown): void {
  if (isEnoent(err)) return;
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`agent-review: workstream: ${context}: ${msg}`);
}

export function parseRunIdShortSha(runId: string): string | undefined {
  const match = runId.trim().match(/Z-(.+)$/);
  const sha = match?.[1]?.trim();
  return sha !== undefined && sha.length > 0 ? sha : undefined;
}

export function isWorkstreamSha(sha: string): boolean {
  return sha.length > 0 && !SKIP_SHAS.has(sha);
}

export function listWorkstreamRunIds(
  outputDir: string,
  shortSha: string,
  excludeRunId?: string,
): string[] {
  if (!isWorkstreamSha(shortSha)) return [];
  const root = reviewsRoot(outputDir);
  if (!existsSync(root)) return [];
  const suffix = `Z-${shortSha}`;
  try {
    return readdirSync(root)
      .filter((name) => {
        if (name === excludeRunId) return false;
        if (!name.endsWith(suffix)) return false;
        try {
          return statSync(path.join(root, name)).isDirectory();
        } catch (err) {
          warnWorkstream(`stat ${name}`, err);
          return false;
        }
      })
      .sort();
  } catch (err) {
    warnWorkstream(`readdir ${root}`, err);
    return [];
  }
}

function clip(text: string, max: number): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n…(truncated)`;
}

function lastWorkLogLine(workLogPath: string): string | undefined {
  try {
    if (!existsSync(workLogPath)) return undefined;
    const lines = readFileSync(workLogPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const last = lines[lines.length - 1];
    if (last === undefined) return undefined;
    try {
      const row = JSON.parse(last) as {
        event?: string;
        status?: string;
        message?: string;
      };
      const bits = [row.event, row.status, row.message].filter(
        (bit): bit is string => typeof bit === "string" && bit.length > 0,
      );
      return bits.length > 0 ? bits.join(" — ") : last;
    } catch {
      return last;
    }
  } catch (err) {
    warnWorkstream(`read work-log ${workLogPath}`, err);
    return undefined;
  }
}

function readOptionalFile(filePath: string, max: number): string | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const text = readFileSync(filePath, "utf8").trim();
    if (text.length === 0) return undefined;
    return clip(text, max);
  } catch (err) {
    warnWorkstream(`read ${filePath}`, err);
    return undefined;
  }
}

function formatFinding(finding: ReviewRunArtifact["findings"][number]): string {
  const loc = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
  const rule = finding.rule !== undefined ? ` [${finding.rule}]` : "";
  const decision = finding.decision;
  let verdict = "undecided";
  if (decision?.verdict === "ignore") {
    verdict = `ignore (${decision.rationale})`;
  } else if (decision?.verdict === "remediate") {
    verdict = `remediate: ${decision.task}`;
  }
  return `- ${finding.severity} ${loc}${rule}${finding.key ? ` key=${finding.key}` : ""} — ${finding.message}\n  decision: ${verdict}`;
}

function formatRemediations(outputDir: string, runId: string): string[] {
  try {
    const remDir = path.join(runDir(outputDir, runId), "remediations");
    if (!existsSync(remDir)) return [];
    const names = readdirSync(remDir)
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(a) - Number(b));
    const blocks: string[] = [];
    for (const name of names) {
      try {
        const abs = path.join(remDir, name);
        if (!statSync(abs).isDirectory()) continue;
        const lines = [`Remediation ${name}:`];
        const plan = readOptionalFile(path.join(abs, PLAN_FILENAME), PLAN_EXCERPT);
        if (plan !== undefined) lines.push(plan);
        const logLine = lastWorkLogLine(path.join(abs, "work-log.jsonl"));
        if (logLine !== undefined) lines.push(`Work log: ${logLine}`);
        const changes = readOptionalFile(path.join(abs, "changes.md"), ARTIFACT_EXCERPT);
        if (changes !== undefined) lines.push(`Changes:\n${changes}`);
        const tests = readOptionalFile(path.join(abs, "tests.txt"), ARTIFACT_EXCERPT);
        if (tests !== undefined) lines.push(`Tests:\n${tests}`);
        if (lines.length > 1) blocks.push(lines.join("\n"));
      } catch (err) {
        warnWorkstream(`remediation ${runId}/${name}`, err);
      }
    }
    return blocks;
  } catch (err) {
    warnWorkstream(`remediations ${runId}`, err);
    return [];
  }
}

function formatRunBody(outputDir: string, artifact: ReviewRunArtifact): string {
  const lines = [
    `### Run ${artifact.runId} (exit ${artifact.exitCode})`,
    artifact.summary.length > 0 ? `Summary: ${artifact.summary}` : null,
    artifact.commitMessage !== undefined ? `Commit message: ${artifact.commitMessage}` : null,
  ];
  if (artifact.findings.length > 0) {
    lines.push("Findings:", ...artifact.findings.map(formatFinding));
  } else {
    lines.push("Findings: (none)");
  }
  const remediations = formatRemediations(outputDir, artifact.runId);
  if (remediations.length > 0) lines.push(...remediations);
  if (artifact.files.length > 0) {
    lines.push("Files:", ...artifact.files.map((file) => `- ${file}`));
  }
  return lines.filter((line): line is string => line !== null).join("\n");
}

function formatRunDiff(artifact: ReviewRunArtifact): string | undefined {
  const diff = artifact.diff?.trim() ?? "";
  if (diff.length === 0) return undefined;
  return `Diff as of that review:\n${clip(diff, DIFF_PER_RUN)}`;
}

export function formatWorkstreamContext(input: {
  outputDir: string;
  shortSha: string;
  runIds: string[];
}): string | undefined {
  if (input.runIds.length === 0 || !isWorkstreamSha(input.shortSha)) {
    return undefined;
  }

  const header = [
    `Prior review workstream for the same HEAD ${input.shortSha}.`,
    "A previous review blocked this commit; remediations were applied and the staged diff is being reviewed again.",
    "Use this history to avoid re-litigating already-fixed issues, to check whether remediations introduced new problems, and to continue unresolved work.",
  ].join(" ");

  const artifacts: ReviewRunArtifact[] = [];
  for (const runId of input.runIds) {
    try {
      artifacts.push(loadRunArtifact(input.outputDir, runId));
    } catch (err) {
      warnWorkstream(`load run ${runId}`, err);
    }
  }
  if (artifacts.length === 0) return undefined;

  const bodies: Array<string | undefined> = [];
  const diffs: Array<string | undefined> = [];
  for (const row of artifacts) {
    let body: string | undefined;
    let diff: string | undefined;
    try {
      body = formatRunBody(input.outputDir, row);
      diff = formatRunDiff(row);
    } catch (err) {
      warnWorkstream(`format run ${row.runId}`, err);
    }
    bodies.push(body);
    diffs.push(diff);
  }

  const includeDiff = diffs.map((part) => part !== undefined);
  const assemble = (): string =>
    artifacts
      .map((_, i) => {
        const body = bodies[i];
        if (body === undefined || body.length === 0) return undefined;
        const diff = includeDiff[i] === true ? diffs[i] : undefined;
        return diff !== undefined ? `${body}\n${diff}` : body;
      })
      .filter((part): part is string => part !== undefined)
      .join("\n\n");

  let assembled = assemble();
  let text = `${header}\n\n${assembled}`;

  for (let i = 0; i < artifacts.length; i++) {
    if (text.length <= TOTAL_BUDGET) break;
    includeDiff[i] = false;
    assembled = assemble();
    text = `${header}\n\n${assembled}`;
  }

  return `<prior_workstream_history>\n${clip(text, TOTAL_BUDGET)}\n</prior_workstream_history>`;
}

export function loadWorkstreamPrompt(input: {
  outputDir: string;
  runId: string;
  shortSha?: string;
}): string | undefined {
  const shortSha = input.shortSha ?? parseRunIdShortSha(input.runId);
  if (shortSha === undefined || !isWorkstreamSha(shortSha)) return undefined;
  const runIds = listWorkstreamRunIds(input.outputDir, shortSha, input.runId);
  return formatWorkstreamContext({
    outputDir: input.outputDir,
    shortSha,
    runIds,
  });
}
