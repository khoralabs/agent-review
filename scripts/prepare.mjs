#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, ".git"))) {
  process.exit(0);
}

const result = spawnSync("bunx", ["husky"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
