import type { generateText } from "ai";

import type { AgentReviewConfig } from "../config.ts";
import { writeAgentSnapshotIfAbsent } from "../lib/agent-snapshot.ts";
import { type CollectedDiff, collectDiff, type DiffScope } from "../lib/git.ts";
import { resolveOutputDir } from "../lib/observability.ts";
import { logStatus } from "../lib/status.ts";
import { loadSkillPrompt } from "../skills/index.ts";
import { runCommitMessageAgent } from "./commit-message.ts";

export type RunCommitMessagePhaseInput = {
  config: AgentReviewConfig;
  scope?: DiffScope;
  base?: string;
  head?: string;
  commit?: string;
  cwd?: string;
  stdinText?: string;
  generateTextFn?: typeof generateText;
  collectDiffFn?: typeof collectDiff;
  skipArtifacts?: boolean;
  quiet?: boolean;
};

export type RunCommitMessagePhaseResult = {
  exitCode: 0 | 2;
  message: string;
  commitMessage?: string;
};

export async function runCommitMessagePhase(
  input: RunCommitMessagePhaseInput,
): Promise<RunCommitMessagePhaseResult> {
  const cwd = input.cwd ?? process.cwd();
  const scope = input.scope ?? input.config.defaultScope;
  const commit = scope === "commit" ? input.commit?.trim() || "HEAD" : input.commit;
  const quiet = input.quiet === true;
  const skipObs = input.skipArtifacts === true;
  const outputDir = resolveOutputDir(cwd, input.config.outputDir);

  try {
    const collect = input.collectDiffFn ?? collectDiff;
    logStatus(quiet, "commit-message: collecting diff…");
    const diff: CollectedDiff = await collect({
      scope,
      base: input.base,
      head: input.head,
      commit,
      cwd,
      maxDiffBytes: input.config.maxDiffBytes,
      stdinText: input.stdinText,
    });

    if (diff.empty) {
      logStatus(quiet, "commit-message: no changes");
      return { exitCode: 2, message: "No changes to describe." };
    }

    const skills = loadSkillPrompt(input.config, cwd);
    if (skills.error !== undefined) {
      logStatus(quiet, `commit-message: ${skills.error}`);
      return { exitCode: 2, message: skills.error };
    }

    logStatus(quiet, "commit-message: agent starting…");
    const generated = await runCommitMessageAgent({
      cwd,
      runId: "commit-message",
      modelId: input.config.model.commitMessage,
      diff,
      skillSystem: skills.system,
      generateTextFn: input.generateTextFn,
      testModel: input.generateTextFn !== undefined,
    });
    if (!skipObs) {
      await writeAgentSnapshotIfAbsent(outputDir, generated.agent);
    }
    const commitMessage = generated.result.message.trim();
    if (commitMessage.length === 0) {
      return { exitCode: 2, message: "model returned an empty commit message" };
    }
    logStatus(quiet, "commit-message: done");
    return { exitCode: 0, message: commitMessage, commitMessage };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logStatus(quiet, `commit-message: ${error}`);
    return { exitCode: 2, message: error };
  }
}
