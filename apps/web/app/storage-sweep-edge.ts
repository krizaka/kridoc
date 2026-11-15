import { dbTenantKeyStore } from "@krizaka/storage";

import { databaseOf } from "@/lib/db/connection";
import { createRetentionStore, createSweepCursor } from "@/lib/db/retention-store";
import { type Env, SETTINGS } from "@/lib/env";
import { ownerObjectsOf } from "@/lib/storage/document-vault";
import { objectStoreOf, platformFetch } from "@/lib/storage/object-store";
import { type SweepResult, sweepStorage } from "@/lib/storage/retention-sweep";

import { logKeyEvent, storageConfigOf, vaultRootKeyOf } from "./storage-edge";
import { storageRulesFor, storageTrailOf } from "./storage-rules-edge";
import { systemClock } from "./system-clock";

/** One bounded retention sweep run on the real store and database (the job's whole composition: `pnpm storage:sweep` calls it). */
export function runStorageSweep(env: Env): Promise<SweepResult> {
  const { query } = databaseOf(env);
  return sweepStorage({
    store: createRetentionStore(query),
    cursor: createSweepCursor(query),
    objects: ownerObjectsOf(objectStoreOf(storageConfigOf(env), { fetch: platformFetch, clock: systemClock }), {
      rootKey: vaultRootKeyOf(env),
      keys: dbTenantKeyStore(query),
      clock: systemClock,
      audit: logKeyEvent,
    }),
    rules: storageRulesFor(env),
    audit: storageTrailOf(env).audit,
    clock: systemClock,
    limits: SETTINGS.retentionSweep,
  });
}
