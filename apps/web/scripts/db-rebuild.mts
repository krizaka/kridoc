// pnpm db:rebuild — DROP the public schema of the database in DATABASE_URL and migrate from zero (krizaka-internal#3717).
// Never production; a non-local host needs --yes. There is no seed yet: Kridoc has no configuration rows.
import { databaseOf } from "../lib/db/connection";
import { migrateDatabase } from "../lib/db/migrations";
import { readEnv } from "../lib/env";

/** A refusal whose text is written in this file, safe to print. */
class RebuildRefusal extends Error {}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

async function main(): Promise<void> {
  const env = readEnv();
  if (env.NODE_ENV === "production") {
    throw new RebuildRefusal("db:rebuild never runs against production");
  }
  if (!env.DATABASE_URL) {
    throw new RebuildRefusal("DATABASE_URL is not set");
  }
  const { connect, pool, query } = databaseOf(env);
  const local = LOCAL.has(new URL(env.DATABASE_URL).hostname);
  if (!local && !process.argv.includes("--yes")) {
    throw new RebuildRefusal("DATABASE_URL is not a local database: pass --yes to rebuild it");
  }
  console.log(local ? "db:rebuild: local database" : "db:rebuild: remote database (--yes)");
  await query("DROP SCHEMA public CASCADE");
  await query("CREATE SCHEMA public");
  console.log(`migrated: ${(await migrateDatabase(connect)).join(", ")}`);
  await pool().end();
}

main().catch((error: unknown) => {
  console.error(error instanceof RebuildRefusal ? error.message : "db:rebuild failed (see the server log)");
  if (!(error instanceof RebuildRefusal)) console.error(error);
  process.exit(1);
});
