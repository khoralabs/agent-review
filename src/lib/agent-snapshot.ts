import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import type { RegisteredAgent } from "@khoralabs/agent-capabilities";

import { agentSnapshotLegacyPath, agentSnapshotPath, agentsDir } from "./paths.ts";

/** Content-addressed static agent registration snapshot (JSON-safe). */
export type AgentCapabilitySnapshot = {
  agentId: string;
  name: string;
  staticHash: string;
  staticInstructions: string[];
  staticContext: Record<string, unknown>;
  rootComposable: {
    kind: string;
    name: string;
    staticHash: string;
  };
  recordedAt: string;
};

/**
 * Process-local snapshot cache (gzip or legacy path → snapshot).
 * `null` means a prior parse failed (do not re-read).
 */
const snapshotCache = new Map<string, AgentCapabilitySnapshot | null>();

function warnSnapshot(message: string): void {
  console.warn(`agent-review: agent-snapshot: ${message}`);
}

function cloneSnapshot(snapshot: AgentCapabilitySnapshot): AgentCapabilitySnapshot {
  return structuredClone(snapshot);
}

export async function buildAgentCapabilitySnapshot(
  agent: RegisteredAgent,
): Promise<AgentCapabilitySnapshot> {
  const root = agent.rootComposable;
  return {
    agentId: agent.agentId,
    name: agent.name,
    staticHash: agent.staticHash,
    staticInstructions: [...agent.staticInstructions],
    staticContext: { ...agent.staticContext },
    rootComposable: {
      kind: root.staticProps.kind,
      name: root.staticProps.name,
      staticHash: await root.computeStaticHash(),
    },
    recordedAt: new Date().toISOString(),
  };
}

function isAgentCapabilitySnapshot(value: unknown): value is AgentCapabilitySnapshot {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.agentId !== "string") return false;
  if (typeof o.name !== "string") return false;
  if (typeof o.staticHash !== "string") return false;
  if (!Array.isArray(o.staticInstructions)) return false;
  if (!o.staticInstructions.every((s) => typeof s === "string")) return false;
  if (o.staticContext === null || typeof o.staticContext !== "object") {
    return false;
  }
  if (o.rootComposable === null || typeof o.rootComposable !== "object") {
    return false;
  }
  const root = o.rootComposable as Record<string, unknown>;
  if (typeof root.kind !== "string") return false;
  if (typeof root.name !== "string") return false;
  if (typeof root.staticHash !== "string") return false;
  if (typeof o.recordedAt !== "string") return false;
  return true;
}

function tryParseGzipSnapshot(gzipPath: string): AgentCapabilitySnapshot | undefined {
  if (snapshotCache.has(gzipPath)) {
    const cached = snapshotCache.get(gzipPath);
    return cached == null ? undefined : cloneSnapshot(cached);
  }
  try {
    const compressed = readFileSync(gzipPath);
    const text = Buffer.from(Bun.gunzipSync(compressed)).toString("utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isAgentCapabilitySnapshot(parsed)) {
      snapshotCache.set(gzipPath, null);
      return undefined;
    }
    snapshotCache.set(gzipPath, parsed);
    return cloneSnapshot(parsed);
  } catch {
    snapshotCache.set(gzipPath, null);
    return undefined;
  }
}

function removeCorruptGzip(gzipPath: string): void {
  snapshotCache.delete(gzipPath);
  try {
    unlinkSync(gzipPath);
    warnSnapshot(`removed corrupt snapshot ${gzipPath}`);
  } catch {
    /* ignore */
  }
}

/**
 * Path of an existing usable snapshot, or undefined if a new gzip may be written.
 * Corrupt `.json.gz` is removed so write can repair it.
 */
function snapshotAlreadyPresent(outputDir: string, staticHash: string): string | undefined {
  const gzipPath = agentSnapshotPath(outputDir, staticHash);
  const cached = snapshotCache.get(gzipPath);
  if (cached != null && existsSync(gzipPath)) {
    return gzipPath;
  }
  if (existsSync(gzipPath)) {
    if (cached === null) {
      removeCorruptGzip(gzipPath);
    } else if (tryParseGzipSnapshot(gzipPath) !== undefined) {
      return gzipPath;
    } else {
      removeCorruptGzip(gzipPath);
    }
  }
  const legacyPath = agentSnapshotLegacyPath(outputDir, staticHash);
  if (existsSync(legacyPath)) {
    warnSnapshot(`using legacy snapshot ${legacyPath}`);
    return legacyPath;
  }
  return undefined;
}

/**
 * Write `agents/<staticHash>.json.gz` once (content-addressed).
 * Skips when a readable `.json.gz` or legacy `.json` already exists.
 * Rewrites when existing `.json.gz` is corrupt.
 * Returns the absolute path when written or already present; undefined on failure.
 */
export async function writeAgentSnapshotIfAbsent(
  outputDir: string,
  agent: RegisteredAgent,
): Promise<string | undefined> {
  const existing = snapshotAlreadyPresent(outputDir, agent.staticHash);
  if (existing !== undefined) return existing;
  try {
    mkdirSync(agentsDir(outputDir), { recursive: true });
    const again = snapshotAlreadyPresent(outputDir, agent.staticHash);
    if (again !== undefined) return again;

    const dest = agentSnapshotPath(outputDir, agent.staticHash);
    const snapshot = await buildAgentCapabilitySnapshot(agent);
    const payload = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const compressed = Bun.gzipSync(payload);
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, compressed);
      const raced = snapshotAlreadyPresent(outputDir, agent.staticHash);
      if (raced !== undefined) return raced;
      renameSync(tmp, dest);
      snapshotCache.set(dest, snapshot);
      return dest;
    } finally {
      if (existsSync(tmp)) {
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    return undefined;
  }
}

function readLegacyAgentSnapshot(
  outputDir: string,
  staticHash: string,
): AgentCapabilitySnapshot | undefined {
  const legacyPath = agentSnapshotLegacyPath(outputDir, staticHash);
  if (snapshotCache.has(legacyPath)) {
    const cached = snapshotCache.get(legacyPath);
    return cached == null ? undefined : cloneSnapshot(cached);
  }
  if (!existsSync(legacyPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(legacyPath, "utf8"));
    if (!isAgentCapabilitySnapshot(parsed)) {
      snapshotCache.set(legacyPath, null);
      return undefined;
    }
    snapshotCache.set(legacyPath, parsed);
    return cloneSnapshot(parsed);
  } catch {
    snapshotCache.set(legacyPath, null);
    return undefined;
  }
}

/**
 * Load a static agent snapshot. Prefers `.json.gz`, falls back to legacy `.json`
 * when the gzip path is missing or unreadable.
 */
export function readAgentSnapshot(
  outputDir: string,
  staticHash: string,
): AgentCapabilitySnapshot | undefined {
  const gzipPath = agentSnapshotPath(outputDir, staticHash);
  if (snapshotCache.has(gzipPath)) {
    const cached = snapshotCache.get(gzipPath);
    if (cached != null) return cloneSnapshot(cached);
    // Cached failure: skip re-gunzip; try legacy.
  } else if (existsSync(gzipPath)) {
    const parsed = tryParseGzipSnapshot(gzipPath);
    if (parsed !== undefined) return parsed;
    warnSnapshot(`corrupt gzip snapshot ${gzipPath}; falling back to legacy`);
  }
  return readLegacyAgentSnapshot(outputDir, staticHash);
}
