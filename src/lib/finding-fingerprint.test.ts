import { describe, expect, test } from "bun:test";

import { findingFingerprint, normalizeFindingKey } from "./finding-fingerprint.ts";

describe("findingFingerprint", () => {
  test("same key+file+rule → same fingerprint regardless of message wording", () => {
    const a = findingFingerprint({
      key: "unstable-empty-templates-fallback",
      file: "apps/form.tsx",
      rule: "React Hook Dependency",
    });
    const b = findingFingerprint({
      key: "unstable-empty-templates-fallback",
      file: "apps/form.tsx",
      rule: "React Hook Dependency",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test("normalizes key case and separators", () => {
    expect(normalizeFindingKey(" Unstable_Empty Templates ")).toBe("unstable-empty-templates");
    expect(
      findingFingerprint({
        key: "Unstable_Empty-Templates",
        file: "./apps/form.tsx",
      }),
    ).toBe(
      findingFingerprint({
        key: "unstable-empty-templates",
        file: "apps/form.tsx",
      }),
    );
  });

  test("distinct keys or files produce distinct fingerprints", () => {
    const base = {
      key: "null-deref",
      file: "a.ts",
      rule: "correctness",
    };
    expect(findingFingerprint(base)).not.toBe(findingFingerprint({ ...base, key: "other-issue" }));
    expect(findingFingerprint(base)).not.toBe(findingFingerprint({ ...base, file: "b.ts" }));
    expect(findingFingerprint(base)).not.toBe(findingFingerprint({ ...base, rule: "security" }));
  });
});
