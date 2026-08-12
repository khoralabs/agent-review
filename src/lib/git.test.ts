import { describe, expect, test } from "bun:test";

import { gitArgsForScope } from "./git.ts";

describe("gitArgsForScope", () => {
  test("commit uses two-dot parent..rev", () => {
    const cmds = gitArgsForScope({ scope: "commit", commit: "HEAD" });
    expect(cmds.diff).toEqual(["diff", "HEAD^..HEAD"]);
    expect(cmds.nameStatus).toEqual(["diff", "--name-status", "HEAD^..HEAD"]);
  });

  test("commit defaults rev to HEAD", () => {
    const cmds = gitArgsForScope({ scope: "commit" });
    expect(cmds.diff).toEqual(["diff", "HEAD^..HEAD"]);
  });

  test("range uses triple-dot", () => {
    const cmds = gitArgsForScope({
      scope: "range",
      base: "origin/main",
      head: "HEAD",
    });
    expect(cmds.diff).toEqual(["diff", "origin/main...HEAD"]);
  });

  test("staged uses cached", () => {
    const cmds = gitArgsForScope({ scope: "staged" });
    expect(cmds.diff).toEqual(["diff", "--cached"]);
  });
});
