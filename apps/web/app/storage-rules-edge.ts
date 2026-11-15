import { type AuditEntryInput, createAudit } from "@krizaka/audit";
import { dbSettings } from "@krizaka/settings";

import { databaseOf } from "@/lib/db/connection";
import type { Env } from "@/lib/env";
import { storageAuditOf } from "@/lib/storage/audit-trail";
import { storageRulesOf, storageSettings, type StorageSettingsService } from "@/lib/storage/storage-settings";

import { systemClock } from "./system-clock";

// The administrator's storage rules and the audit trail, over Kridoc's database: shared by the documents (documents-edge.ts), the
// products' API (storage-api-edge.ts), the admin (storage-admin-edge.ts) and the sweep. The only place that builds them.

// @fixed: how long a read of the settings is served from memory; this instance sees a change at once, another within this time
const SETTINGS_CACHE_MS = 5000;

const holder = globalThis as unknown as { __kridocStorageSettings?: StorageSettingsService };

/** The settings service, one per process (it holds the short cache). */
export function storageSettingsOf(env: Env): StorageSettingsService {
  holder.__kridocStorageSettings ??= dbSettings(storageSettings, {
    query: databaseOf(env).query,
    cacheMs: SETTINGS_CACHE_MS,
    clock: () => performance.now(),
  });
  return holder.__kridocStorageSettings;
}

/** The rules every upload and every link reads: asked each time, so a change applies at once. */
export const storageRulesFor = (env: Env) => storageRulesOf(storageSettingsOf(env));

/** The trail of `@krizaka/audit` on the database: a failed quiet write is logged by its kind only, never its content. */
export function storageTrailOf(env: Env) {
  const { query } = databaseOf(env);
  const trail = createAudit({
    clock: systemClock,
    onError: (error: unknown, entry: AuditEntryInput) =>
      console.error(
        `storage-audit: a line could not be written (${entry.action}, ${error instanceof Error ? error.name : typeof error})`,
      ),
  });
  return {
    /** Beside the act: its failure does not fail the act. */
    audit: storageAuditOf((entry) => trail.recordQuietly(query, entry)),
    /** In the act: its failure fails it (the administrator's change). */
    record: (entry: AuditEntryInput) => trail.record(query, entry),
    list: (filters: Parameters<typeof trail.list>[1]) => trail.list(query, filters),
  };
}
