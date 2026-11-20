import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RUNBOOK = resolve(__dirname, "../../../../docs/runbooks/storage-api.md");

/** The numbered steps of the runbook: each must name a command (in backticks) or a screen. */
const stepsOf = (text: string): string[] => text.split("\n").filter((line) => /^\d+\.\s/.test(line));

describe("the storage API runbook", () => {
  const text = readFileSync(RUNBOOK, "utf8");
  const steps = stepsOf(text);

  it("has a section for each incident the design names", () => {
    for (const title of ["Kridoc down or slow", "A key leaked", "A tenant at its quota", "The bucket unreachable", "A restore"])
      expect(text).toContain(`## ${title}`);
    expect(steps.length).toBeGreaterThanOrEqual(10);
  });

  it("names a command or a screen in every step", () => {
    const vague = steps.filter((step) => !/`[^`]+`/.test(step) && !/\bscreen\b/i.test(step));
    expect(vague).toEqual([]);
  });

  it("fails on a step that names neither", () => {
    expect(stepsOf("1. Fix it somehow.").filter((s) => !/`[^`]+`/.test(s) && !/\bscreen\b/i.test(s))).toHaveLength(1);
  });
});
