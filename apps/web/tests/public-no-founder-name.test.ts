import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Founder decision (krizaka-internal#2635, conformance rule `public-no-founder-name`): no founder name on any public surface.
// The names are never written in this public repository: the CI and the conformance run give them in OPERATOR_FOUNDER_NAMES
// (comma separated). Without it the name-free checks below still run and the name scan says it was skipped.
const NAMES = (process.env.OPERATOR_FOUNDER_NAMES ?? "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(
    (f) =>
      f &&
      !f.endsWith("pnpm-lock.yaml") &&
      !/\.(png|jpe?g|webp|ico|woff2?|mp4|webm|svg)$/i.test(f) &&
      !/(^|\/)[^/]*public-no-founder-name[^/]*$/.test(f),
  );
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("no founder name on a public surface", () => {
  it.skipIf(NAMES.length === 0)(
    "names no founder in any tracked file (code, messages, docs, licence, manifests)",
    () => {
      const rx = new RegExp(
        `(?<![\\p{L}\\d])(${NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\d])`,
        "iu",
      );
      const hits = tracked.filter((f) => {
        try {
          return rx.test(read(f));
        } catch {
          return false;
        }
      });
      expect(hits).toEqual([]);
    },
  );

  it("states no person as the company's author or owner: « Krizaka » in every package manifest", () => {
    for (const file of tracked.filter((f) => /(^|\/)package\.json$/.test(f))) {
      const { author } = JSON.parse(read(file)) as { author?: string | { name?: string } };
      if (author === undefined) continue;
      const name = typeof author === "string" ? author : (author.name ?? "");
      expect(name, `${file} author`).toMatch(/^(Technologies )?Krizaka( Inc\.)?$/);
    }
  });

  it("says « founded in Montréal », never « founded by » a person", () => {
    for (const file of tracked.filter(
      (f) => /\.(json|md|mdx|txt|tsx?)$/.test(f) && !/(^|\/)CHANGELOG\.md$|\.test\./.test(f),
    )) {
      expect(read(file), file).not.toMatch(/fondée? par|founded by/i);
    }
  });
});
