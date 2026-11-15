import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Connect, migrate, type ProductMigration } from "@krizaka/db";
import { isIsoDate, isSlug } from "@krizaka/time";

/** The dated files of Kridoc's schema, applied once each and in name order (skill krizaka-sql). */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../infra/migrations/", import.meta.url));

// @fixed: the advisory-lock key every instance takes while migrating; changing it would let two instances migrate at once
export const MIGRATION_LOCK_KEY = 73717;

const DATE_LENGTH = "YYYY-MM-DD".length;

/** `YYYY-MM-DD-name.sql`: a real calendar date, then a slug. */
const isMigrationName = (name: string): boolean =>
  name.endsWith(".sql") &&
  isIsoDate(name.slice(0, DATE_LENGTH)) &&
  name[DATE_LENGTH] === "-" &&
  isSlug(name.slice(DATE_LENGTH + 1, -".sql".length));

/** The migrations of a folder as the runner takes them (version = file name without `.sql`); a file that is not `YYYY-MM-DD-name.sql` is refused. */
export async function readMigrations(dir: string = MIGRATIONS_DIR): Promise<ProductMigration[]> {
  const files = (await readdir(dir)).filter((name) => !name.startsWith("."));
  const bad = files.filter((name) => !isMigrationName(name));
  if (bad.length > 0) {
    throw new Error(`migration files must be named YYYY-MM-DD-name.sql: ${bad.join(", ")}`);
  }
  files.sort((a, b) => a.localeCompare(b));
  return Promise.all(
    files.map(async (name) => ({
      version: name.slice(0, -".sql".length),
      sql: await readFile(join(dir, name), "utf8"),
    })),
  );
}

/** Applies the migrations not applied yet, one transaction each, under an advisory lock; returns the versions applied now. */
export async function migrateDatabase(connect: Connect, dir?: string): Promise<string[]> {
  return migrate(connect, await readMigrations(dir), { lockKey: MIGRATION_LOCK_KEY });
}
