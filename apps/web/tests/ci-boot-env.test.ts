import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PRODUCTION_REQUIREMENTS } from "../lib/env";

// The CI script that starts the built app in production must give it every key the boot requires: a key made required in
// env.ts and forgotten there would kill the CI at boot. This test names the script instead.
const script = readFileSync(new URL("../../../scripts/ci-after-build.sh", import.meta.url), "utf8");
const exported = [...script.matchAll(/\b([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]);

describe("the CI script that starts Kridoc in production", () => {
  it("exports every key the boot requires", () => {
    // Empty while no feature needs a key (see PRODUCTION_REQUIREMENTS): the loop then checks nothing, and starts to the day a slice adds one.
    for (const { key } of PRODUCTION_REQUIREMENTS)
      expect(exported, `${key} in scripts/ci-after-build.sh`).toContain(key);
  });
});
