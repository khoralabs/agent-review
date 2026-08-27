import fs from "node:fs";
import path from "node:path";

const PACKAGE_NAME = "@khoralabs/agent-review";

/** Absolute path to this package's install / source root. */
export function resolvePackageRoot(fromDir: string = import.meta.dir): string {
  let dir = path.resolve(fromDir);
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
        if (raw.name === PACKAGE_NAME) return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`could not resolve ${PACKAGE_NAME} package root from ${fromDir}`);
    }
    dir = parent;
  }
}

export function packagedCodeReviewSkillPath(): string {
  return path.join(resolvePackageRoot(), "skills", "agent-review", "review", "code-review");
}

export function packagedOperatorSkillPath(): string {
  return path.join(resolvePackageRoot(), "skills", "agent-review");
}

export function packagedExampleConfigPath(): string {
  return path.join(resolvePackageRoot(), ".agent-review.example.json");
}
