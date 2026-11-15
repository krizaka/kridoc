import { createTestDatabase, endPool, type TestDatabase } from "@krizaka/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectionOf } from "./connection";
import { createDocumentStore, type DocumentStore, LIST_LIMIT } from "./document-store";
import { migrateDatabase } from "./migrations";
import { poolConfig } from "./pool-config";

/**
 * The SQL against a real PostgreSQL (CI's service container; locally a throwaway one, `DATABASE_URL=… pnpm test`). Never skipped:
 * without DATABASE_URL the file fails, it does not pass by doing nothing.
 */
const url = process.env.DATABASE_URL;

const OWNER = "00000000-0000-4000-8000-000000000001";
const STRANGER = "00000000-0000-4000-8000-000000000002";
const FILE = { title: "Lease", mediaType: "application/pdf", sizeBytes: 1234 };

describe("Kridoc's database", () => {
  const pools: pg.Pool[] = [];
  let testDatabase: TestDatabase;
  let pool: pg.Pool;
  let store: DocumentStore;
  let connect: () => ReturnType<typeof connectionOf>;

  const poolOn = (database?: string) => {
    if (!url) throw new Error("DATABASE_URL is not set: the database tests never skip");
    const target = new URL(url);
    if (database) target.pathname = `/${database}`;
    const made = new pg.Pool({ ...poolConfig({ DATABASE_URL: target.toString() }), max: 2 });
    pools.push(made);
    return made;
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase({
      prefix: "kridoc",
      connect: (database) => connectionOf(poolOn(database)),
      migrate: async (open) => {
        await migrateDatabase(open);
      },
    });
    pool = poolOn(testDatabase.name);
    connect = () => connectionOf(pool);
    store = createDocumentStore(async (text, values = []) => (await pool.query(text, values)).rows);
  });

  afterAll(async () => {
    for (const made of pools) await endPool(made);
    await testDatabase?.drop();
  });

  it("migrates once, idempotently", async () => {
    expect(await migrateDatabase(connect)).toEqual([]);
  });

  it("stores a document's metadata and reads it back for its owner", async () => {
    const added = await store.add({ ownerId: OWNER, ...FILE });
    expect(added).toMatchObject({ ownerId: OWNER, ...FILE });
    expect(await store.findForOwner(OWNER, added.id)).toEqual(added);
  });

  it("never gives a document to another owner", async () => {
    const added = await store.add({ ownerId: OWNER, ...FILE });
    expect(await store.findForOwner(STRANGER, added.id)).toBeNull();
    expect(await store.listByOwner(STRANGER)).toEqual([]);
  });

  it("lists the owner's documents newest first, within the bound", async () => {
    for (let i = 0; i < 3; i++) await store.add({ ownerId: STRANGER, ...FILE, title: `Doc ${i}` });
    const listed = await store.listByOwner(STRANGER);
    expect(listed.map((d) => d.title)).toEqual(["Doc 2", "Doc 1", "Doc 0"]);
    expect(await store.listByOwner(STRANGER, 2)).toHaveLength(2);
    expect(LIST_LIMIT.max).toBeGreaterThan(LIST_LIMIT.default);
  });

  it("refuses what the schema forbids", async () => {
    await expect(store.add({ ownerId: OWNER, ...FILE, title: "" })).rejects.toThrow();
    await expect(store.add({ ownerId: OWNER, ...FILE, sizeBytes: -1 })).rejects.toThrow();
  });
});
