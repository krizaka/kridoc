import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MIGRATIONS_DIR, readMigrations } from "./migrations";

const folderWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "kridoc-migrations-"));
  mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return `${dir}/`;
};

describe("readMigrations", () => {
  it("reads the dated files in name order, the version being the name without .sql", async () => {
    const dir = folderWith({ "2026-12-01-b.sql": "SELECT 2", "2026-11-15-a.sql": "SELECT 1" });
    expect(await readMigrations(dir)).toEqual([
      { version: "2026-11-15-a", sql: "SELECT 1" },
      { version: "2026-12-01-b", sql: "SELECT 2" },
    ]);
  });
  it("refuses a file that is not YYYY-MM-DD-name.sql", async () => {
    await expect(readMigrations(folderWith({ "V1__x.sql": "", "2026-02-30-x.sql": "" }))).rejects.toThrow(
      /YYYY-MM-DD-name\.sql: 2026-02-30-x\.sql, V1__x\.sql/,
    );
  });
  it("finds Kridoc's own migrations, the first being the document metadata", async () => {
    expect((await readMigrations(MIGRATIONS_DIR))[0]?.version).toBe("2026-11-15-document-metadata");
  });
});
