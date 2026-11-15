import { createTestDatabase, endPool, type TestDatabase } from "@krizaka/db/testing";
import { dbTenantKeyStore } from "@krizaka/storage";
import { tenantKeyStoreContract } from "@krizaka/storage/testkit";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectionOf } from "@/lib/db/connection";
import { integrationPools } from "@/lib/db/integration-pool";
import { migrateDatabase } from "@/lib/db/migrations";

/**
 * The tenant keyring of Kridoc's migrations (`storage.tenant_keyring`, `storage.tenant_key`) against a real PostgreSQL (CI's service
 * container; locally a throwaway one, `DATABASE_URL=… pnpm test`), through the contract every `TenantKeyStore` passes. Never skipped.
 */
const url = process.env.DATABASE_URL;

describe("the tenant keyring on PostgreSQL (krizaka-internal#3754)", () => {
  const { poolOn, all } = integrationPools(url);
  let testDatabase: TestDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    testDatabase = await createTestDatabase({
      prefix: "kridoc_keys",
      connect: (database) => connectionOf(poolOn(database)),
      migrate: async (open) => {
        await migrateDatabase(open);
      },
    });
    pool = poolOn(testDatabase.name);
  });

  afterAll(async () => {
    for (const made of all()) await endPool(made);
    await testDatabase?.drop();
  });

  it("are created by Kridoc's migrations in the storage schema, recorded as storage v2", async () => {
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'storage' ORDER BY table_name",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(["tenant_key", "tenant_keyring"]);
    const marker = await pool.query("SELECT module, version FROM public.krizaka_module_versions");
    expect(marker.rows).toEqual([{ module: "storage", version: 2 }]);
  });

  // The contract asks for an empty store each time: the real tables, emptied (the tests of one file run one after the other).
  tenantKeyStoreContract("dbTenantKeyStore over Kridoc's migrations", async () => {
    await pool.query("TRUNCATE storage.tenant_key, storage.tenant_keyring");
    return dbTenantKeyStore(async (text, values = []) => (await pool.query(text, values)).rows);
  });
});
