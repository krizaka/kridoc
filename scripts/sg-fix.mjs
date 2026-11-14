#!/usr/bin/env node
/* eslint-disable no-console -- a command-line tool: its output is the interface */
// The codemods: applies the `fix:` of the ast-grep rules (rules/*.yml) — hand-written time arithmetic → date-fns —
// then adds the date-fns import to each file that now uses one. Behaviour is identical; run the tests after.
//   node scripts/sg-fix.mjs [paths…]     (default: the whole repository)
// Needs the repository's own ast-grep (devDependency @ast-grep/cli).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DATE_FNS = ["hoursToMilliseconds", "minutesToMilliseconds", "differenceInMilliseconds"];

/**
 * Adds `import { … } from "date-fns"` for the date-fns helpers a source uses without importing them.
 * @param {string} source
 * @returns {string}
 */
export function withDateFnsImports(source) {
  const imported = new Set();
  const existing = /import\s*\{([^}]*)\}\s*from\s*["']date-fns["'];?/.exec(source);
  for (const name of existing?.[1]
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean) ?? [])
    imported.add(name);
  const missing = DATE_FNS.filter((name) => new RegExp(String.raw`\b${name}\(`).test(source) && !imported.has(name));
  if (missing.length === 0) return source;
  const names = [...new Set([...imported, ...missing])].sort((a, b) => a.localeCompare(b));
  const line = `import { ${names.join(", ")} } from "date-fns";`;
  if (existing) return source.replace(existing[0], line);
  const imports = [...source.matchAll(/^import[\s\S]*?from\s*["'][^"']+["'];?[ \t]*$/gm)];
  const last = imports.at(-1);
  if (!last) return `${line}\n${source}`;
  const end = (last.index ?? 0) + last[0].length;
  return `${source.slice(0, end)}\n${line}${source.slice(end)}`;
}

// `git` is resolved through PATH on purpose: a developer tool run by hand on a developer machine, where git lives in no fixed place.
const changedFiles = (root) =>
  spawnSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" }).stdout.split("\n"); // NOSONAR

function run() {
  const root = process.cwd();
  const bin = join(root, "node_modules", ".bin", "ast-grep");
  const paths = process.argv.slice(2);
  const scan = spawnSync(bin, ["scan", "--update-all", ...paths], { cwd: root, encoding: "utf8" });
  if (scan.error) throw scan.error;
  const files = changedFiles(root).filter((f) => /\.(ts|tsx|mts)$/.test(f));
  let touched = 0;
  for (const file of files) {
    const path = resolve(root, file);
    const source = readFileSync(path, "utf8");
    const next = withDateFnsImports(source);
    if (next !== source) {
      writeFileSync(path, next);
      touched += 1;
    }
  }
  console.log(`sg-fix: ${touched} file(s) got a date-fns import. Now: npm run lint && npm test.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
