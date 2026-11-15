import { createTestDatabase, endPool, type TestDatabase } from "@krizaka/db/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RetentionStore, SweepCursor } from "@/lib/storage/retention-port";

import { connectionOf } from "./connection";
import { integrationPools } from "./integration-pool";
import { migrateDatabase } from "./migrations";
import { createRetentionStore, createSweepCursor } from "./retention-store";

/** The sweep's SQL against a real PostgreSQL. Never skipped: without DATABASE_URL the file fails. */
const url = process.env.DATABASE_URL;
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = (n: number) => `00000000-0000-4000-8000-10000000000${n}`;

describe("the retention sweep's database", () => {
  const { poolOn, all } = integrationPools(url);
  let testDatabase: TestDatabase;
  let pool: pg.Pool;
  let store: RetentionStore;
  let cursor: SweepCursor;

  beforeAll(async () => {
    testDatabase = await createTestDatabase({
      prefix: "kridoc",
      connect: (database) => connectionOf(poolOn(database)),
      migrate: async (open) => {
        await migrateDatabase(open);
      },
    });
    pool = poolOn(testDatabase.name);
    const query = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
    store = createRetentionStore(query);
    cursor = createSweepCursor(query);
    await pool.query(
      `INSERT INTO account (id, email, password_hash) VALUES ($1, 'a@example.com', 'x'), ($2, 'b@example.com', 'x'), ($3, 'c@example.com', 'x')`,
      [A, B, C],
    );
    await pool.query(
      `INSERT INTO document (id, owner_id, title, media_type, size_bytes, created_at) VALUES
         ($1, $4, 'old', 'application/pdf', 1, '2020-01-01'), ($2, $4, 'older', 'application/pdf', 1, '2019-01-01'),
         ($3, $5, 'new', 'application/pdf', 1, now())`,
      [D(1), D(2), D(3), A, B],
    );
  });

  afterAll(async () => {
    for (const made of all()) await endPool(made);
    await testDatabase?.drop();
  });

  it("finds the documents older than the cutoff, oldest first, bounded", async () => {
    const cutoff = new Date("2021-01-01");
    expect(await store.expired(cutoff, 10)).toEqual([
      { id: D(2), ownerId: A },
      { id: D(1), ownerId: A },
    ]);
    expect(await store.expired(cutoff, 1)).toEqual([{ id: D(2), ownerId: A }]);
  });

  it("answers which ids are the owner's rows, never another owner's", async () => {
    expect([...(await store.existing(A, [D(1), D(3), D(7)]))]).toEqual([D(1)]);
    expect([...(await store.existing(B, [D(1), D(3)]))]).toEqual([D(3)]);
  });

  it("walks the owners in id order from a cursor, bounded", async () => {
    expect(await store.ownersAfter(null, 2)).toEqual([A, B]);
    expect(await store.ownersAfter(B, 2)).toEqual([C]);
    expect(await store.ownersAfter(C, 2)).toEqual([]);
  });

  it("removes one row of its owner only", async () => {
    expect(await store.remove({ id: D(3), ownerId: A })).toBe(false);
    expect(await store.remove({ id: D(3), ownerId: B })).toBe(true);
    expect(await store.remove({ id: D(3), ownerId: B })).toBe(false);
  });

  it("keeps its place between runs, and starts again from nothing", async () => {
    expect(await cursor.read()).toBeNull();
    await cursor.write(B);
    expect(await cursor.read()).toBe(B);
    await cursor.write(null);
    expect(await cursor.read()).toBeNull();
  });
});
