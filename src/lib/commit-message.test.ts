import { describe, expect, test } from "bun:test";

import { normalizeCommitMessage, resolveCommitMessage } from "./commit-message.ts";

describe("normalizeCommitMessage", () => {
  test("strips git comment lines and trims", () => {
    const raw = [
      "feat: add review",
      "",
      "Body line",
      "# Please enter the commit message",
      "#",
      "# Changes to be committed:",
      "",
    ].join("\n");
    expect(normalizeCommitMessage(raw)).toBe("feat: add review\n\nBody line");
  });
});

describe("resolveCommitMessage", () => {
  test("prefers explicit message", async () => {
    const msg = await resolveCommitMessage({
      cwd: "/tmp",
      scope: "staged",
      message: "  hello  ",
      messageFile: "/nope",
    });
    expect(msg).toBe("hello");
  });

  test("uses git log for commit scope when no explicit message", async () => {
    let seen: string | undefined;
    const msg = await resolveCommitMessage({
      cwd: "/repo",
      scope: "commit",
      commit: "abc",
      gitLogMessageFn: async (rev) => {
        seen = rev;
        return "from git";
      },
    });
    expect(seen).toBe("abc");
    expect(msg).toBe("from git");
  });

  test("returns undefined for staged without message", async () => {
    const msg = await resolveCommitMessage({
      cwd: "/tmp",
      scope: "staged",
    });
    expect(msg).toBeUndefined();
  });
});
