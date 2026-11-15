// pnpm storage:sweep — the retention job (krizaka-internal#3755): removes the documents past the administrator's retention and the
// objects that have no row, one bounded batch per run (SETTINGS.retentionSweep). Run it on a schedule (a DigitalOcean job); safe to run twice.
// DATABASE_URL (and DATABASE_CA_CERT), MEDIA_VAULT_KEY and the MEDIA_* store settings come from the environment. Prints counts only.
import { runStorageSweep } from "../app/storage-sweep-edge";
import { pool } from "../lib/db/connection";
import { readEnv } from "../lib/env";

const env = readEnv();
try {
  if (env.MEDIA_STORAGE_ENABLED !== "on") {
    console.log("storage:sweep: the storage feature is off, nothing to do");
  } else {
    const { expired, orphans, owners } = await runStorageSweep(env);
    console.log(`storage:sweep: ${expired} expired, ${orphans} orphan objects removed (${owners} owners checked)`);
  }
} catch (error: unknown) {
  // The kind of failure only: a run that fails has deleted nothing more (it fails closed) and is run again at the next tick.
  console.error(`storage:sweep failed (${error instanceof Error ? error.name : typeof error})`);
  process.exitCode = 1;
} finally {
  await pool(env).end();
}
