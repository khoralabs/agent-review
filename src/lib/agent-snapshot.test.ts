import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineReviewAgent } from "../agents/review.ts";
import {
  buildAgentCapabilitySnapshot,
  readAgentSnapshot,
  writeAgentSnapshotIfAbsent,
} from "./agent-snapshot.ts";
import { agentSnapshotLegacyPath, agentSnapshotPath } from "./paths.ts";

describe("writeAgentSnapshotIfAbsent", () => {
  test("writes gzip once and does not overwrite", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-"));
    const { agent, staticHash } = await defineReviewAgent();
    const dest = agentSnapshotPath(dir, staticHash);
    expect(dest.endsWith(".json.gz")).toBe(true);

    const first = await writeAgentSnapshotIfAbsent(dir, agent);
    expect(first).toBe(dest);
    expect(fs.existsSync(dest)).toBe(true);

    const parsed = readAgentSnapshot(dir, staticHash);
    expect(parsed).toBeDefined();
    expect(parsed?.agentId).toBe(agent.agentId);
    expect(parsed?.staticHash).toBe(staticHash);
    expect(parsed?.staticInstructions.length).toBeGreaterThan(0);
    expect(parsed?.rootComposable.name).toBe("agent-review");
    expect(parsed?.rootComposable.staticHash.length).toBeGreaterThan(0);

    const before = fs.readFileSync(dest);
    const snapshot = await buildAgentCapabilitySnapshot(agent);
    expect(snapshot.staticHash).toBe(staticHash);
    const second = await writeAgentSnapshotIfAbsent(dir, agent);
    expect(second).toBe(first);
    expect(Buffer.compare(fs.readFileSync(dest), before)).toBe(0);
  });

  test("skips write when legacy .json already exists", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-legacy-"));
    const { agent, staticHash } = await defineReviewAgent();
    const legacy = agentSnapshotLegacyPath(dir, staticHash);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    const legacyBody = {
      agentId: agent.agentId,
      name: agent.name,
      staticHash,
      staticInstructions: ["legacy"],
      staticContext: {},
      rootComposable: {
        kind: "toolkit",
        name: "agent-review",
        staticHash: "x",
      },
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(legacy, `${JSON.stringify(legacyBody)}\n`, "utf8");

    const written = await writeAgentSnapshotIfAbsent(dir, agent);
    expect(written).toBe(legacy);
    expect(fs.existsSync(agentSnapshotPath(dir, staticHash))).toBe(false);
    expect(readAgentSnapshot(dir, staticHash)?.staticInstructions).toEqual(["legacy"]);
  });

  test("rewrites when existing gzip is corrupt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-repair-"));
    const { agent, staticHash } = await defineReviewAgent();
    const gzip = agentSnapshotPath(dir, staticHash);
    fs.mkdirSync(path.dirname(gzip), { recursive: true });
    fs.writeFileSync(gzip, "not-gzip-data");

    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ""));
    };
    try {
      const written = await writeAgentSnapshotIfAbsent(dir, agent);
      expect(written).toBe(gzip);
      expect(readAgentSnapshot(dir, staticHash)?.agentId).toBe(agent.agentId);
      expect(warnings.some((line) => line.includes("removed corrupt"))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  test("rewrites when gzip parses but fails schema validation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-empty-"));
    const { agent, staticHash } = await defineReviewAgent();
    const gzip = agentSnapshotPath(dir, staticHash);
    fs.mkdirSync(path.dirname(gzip), { recursive: true });
    fs.writeFileSync(gzip, Bun.gzipSync(Buffer.from("{}\n")));

    const written = await writeAgentSnapshotIfAbsent(dir, agent);
    expect(written).toBe(gzip);
    expect(readAgentSnapshot(dir, staticHash)?.agentId).toBe(agent.agentId);
  });
});

describe("readAgentSnapshot", () => {
  test("prefers gzip over legacy when both exist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-both-"));
    const { agent, staticHash } = await defineReviewAgent();
    await writeAgentSnapshotIfAbsent(dir, agent);

    const legacy = agentSnapshotLegacyPath(dir, staticHash);
    fs.writeFileSync(
      legacy,
      `${JSON.stringify({
        agentId: "legacy-id",
        name: "legacy",
        staticHash,
        staticInstructions: ["should-not-win"],
        staticContext: {},
        rootComposable: {
          kind: "toolkit",
          name: "agent-review",
          staticHash: "y",
        },
        recordedAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const parsed = readAgentSnapshot(dir, staticHash);
    expect(parsed?.agentId).toBe(agent.agentId);
    expect(parsed?.staticInstructions).not.toEqual(["should-not-win"]);
  });

  test("returns undefined when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-miss-"));
    expect(readAgentSnapshot(dir, "nope")).toBeUndefined();
  });

  test("serves cached gzip snapshot without re-reading disk", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-cache-"));
    const { agent, staticHash } = await defineReviewAgent();
    await writeAgentSnapshotIfAbsent(dir, agent);
    const gzip = agentSnapshotPath(dir, staticHash);
    const first = readAgentSnapshot(dir, staticHash);
    expect(first?.agentId).toBe(agent.agentId);
    fs.unlinkSync(gzip);
    const second = readAgentSnapshot(dir, staticHash);
    expect(second).toEqual(first);
  });

  test("returns clones so callers cannot mutate the cache", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-clone-"));
    const { agent, staticHash } = await defineReviewAgent();
    await writeAgentSnapshotIfAbsent(dir, agent);
    const first = readAgentSnapshot(dir, staticHash);
    expect(first).toBeDefined();
    first?.staticInstructions.push("mutated");
    const second = readAgentSnapshot(dir, staticHash);
    expect(second?.staticInstructions).not.toContain("mutated");
  });

  test("caches legacy snapshots in memory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-legcache-"));
    const { agent, staticHash } = await defineReviewAgent();
    const legacy = agentSnapshotLegacyPath(dir, staticHash);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(
      legacy,
      `${JSON.stringify({
        agentId: agent.agentId,
        name: agent.name,
        staticHash,
        staticInstructions: ["legacy-cached"],
        staticContext: {},
        rootComposable: {
          kind: "toolkit",
          name: "agent-review",
          staticHash: "z",
        },
        recordedAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const first = readAgentSnapshot(dir, staticHash);
    expect(first?.staticInstructions).toEqual(["legacy-cached"]);
    fs.unlinkSync(legacy);
    const second = readAgentSnapshot(dir, staticHash);
    expect(second).toEqual(first);
  });

  test("falls back to legacy when gzip is corrupt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-snap-corrupt-"));
    const { agent, staticHash } = await defineReviewAgent();
    const gzip = agentSnapshotPath(dir, staticHash);
    const legacy = agentSnapshotLegacyPath(dir, staticHash);
    fs.mkdirSync(path.dirname(gzip), { recursive: true });
    fs.writeFileSync(gzip, "not-gzip-data");
    fs.writeFileSync(
      legacy,
      `${JSON.stringify({
        agentId: agent.agentId,
        name: agent.name,
        staticHash,
        staticInstructions: ["from-legacy"],
        staticContext: {},
        rootComposable: {
          kind: "toolkit",
          name: "agent-review",
          staticHash: "z",
        },
        recordedAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ""));
    };
    try {
      const parsed = readAgentSnapshot(dir, staticHash);
      expect(parsed?.staticInstructions).toEqual(["from-legacy"]);
      expect(warnings.some((line) => line.includes("corrupt gzip snapshot"))).toBe(true);
      warnings.length = 0;
      const again = readAgentSnapshot(dir, staticHash);
      expect(again?.staticInstructions).toEqual(["from-legacy"]);
      expect(warnings.some((line) => line.includes("corrupt gzip snapshot"))).toBe(false);
    } finally {
      console.warn = orig;
    }
  });
});
