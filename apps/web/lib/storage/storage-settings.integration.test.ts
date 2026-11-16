import { createAudit } from "@krizaka/audit";
import { createTestDatabase, endPool, type TestDatabase } from "@krizaka/db/testing";
import { dbSettings } from "@krizaka/settings";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ACCOUNT_ROLE } from "@/lib/auth/account-store";
import { connectionOf } from "@/lib/db/connection";
import { integrationPools } from "@/lib/db/integration-pool";
import { migrateDatabase } from "@/lib/db/migrations";

import { STORAGE_ADMIN_ERROR } from "./admin-errors";
import { STORAGE_SETTING, storageRulesOf, storageSettings } from "./storage-settings";
import { createStorageSettingsAdmin, type StorageSettingsAdmin } from "./storage-settings-admin";

/** The administrator's storage settings against a real PostgreSQL (settings and audit tables from the migrations). Never skipped. */
const url = process.env.DATABASE_URL;
const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const USER_ID = "00000000-0000-4000-8000-0000000000b2";
const ADMIN = { id: ADMIN_ID, label: "admin@example.com", role: ACCOUNT_ROLE.admin };
const USER = { id: USER_ID, label: "user@example.com", role: ACCOUNT_ROLE.user };
const MB = 1024 * 1024;

describe("the storage settings of the administrator", () => {
  const { poolOn, all } = integrationPools(url);
  let testDatabase: TestDatabase;
  let pool: pg.Pool;
  let admin: StorageSettingsAdmin;
  let rules: ReturnType<typeof storageRulesOf>;
  const now = new Date("2026-11-15T12:00:00Z");

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
    await pool.query(
      `INSERT INTO account (id, email, password_hash, role) VALUES ($1, 'admin@example.com', 'x', 'ADMIN'), ($2, 'user@example.com', 'x', 'USER')`,
      [ADMIN_ID, USER_ID],
    );
    const settings = dbSettings(storageSettings, { query });
    const trail = createAudit({ clock: { now: () => now } });
    admin = createStorageSettingsAdmin({
      settings,
      record: (entry) => trail.record(query as never, entry),
      list: (filters) => trail.list(query as never, filters),
      clock: { now: () => now },
    });
    rules = storageRulesOf(settings);
  });

  afterAll(async () => {
    for (const made of all()) await endPool(made);
    await testDatabase?.drop();
  });

  it("starts at the defaults the code had before the admin existed", async () => {
    expect(await rules()).toEqual({
      maxBytes: 25 * MB,
      types: ["application/octet-stream", "application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"],
      signedUrlSeconds: 300,
      retentionDays: 3650,
      quotaBytes: 10_240 * MB,
      quotaObjects: 100_000,
    });
  });

  it("lets only an administrator read or change them", async () => {
    await expect(admin.change(USER, { [STORAGE_SETTING.maxMb]: 5 })).rejects.toMatchObject({
      code: STORAGE_ADMIN_ERROR.forbidden,
    });
    await expect(admin.current(USER)).rejects.toMatchObject({ code: STORAGE_ADMIN_ERROR.forbidden });
    await expect(admin.recent(USER)).rejects.toMatchObject({ code: STORAGE_ADMIN_ERROR.forbidden });
    expect((await rules()).maxBytes).toBe(25 * MB);
  });

  it("refuses an unknown key or a value outside its bounds, and writes none of the change", async () => {
    for (const bad of [
      { [STORAGE_SETTING.maxMb]: 0 },
      { [STORAGE_SETTING.maxMb]: 101 },
      { [STORAGE_SETTING.signedUrlSeconds]: 10 },
      { [STORAGE_SETTING.retentionDays]: 3651 },
      { [STORAGE_SETTING.allowedTypes]: ["text/html"] },
      { "storage.nope": 1 },
      { "audit.retentionDays": 1 },
    ])
      await expect(admin.change(ADMIN, bad)).rejects.toMatchObject({ code: STORAGE_ADMIN_ERROR.invalid });
    // The valid half of a half-valid change is not applied either.
    await expect(
      admin.change(ADMIN, { [STORAGE_SETTING.maxMb]: 7, [STORAGE_SETTING.retentionDays]: 1 }),
    ).rejects.toMatchObject({ code: STORAGE_ADMIN_ERROR.invalid });
    expect((await rules()).maxBytes).toBe(25 * MB);
    expect(await admin.recent(ADMIN)).toEqual([]);
  });

  it("applies a change at once to the rules the services read, and audits it (who, which setting, before, after)", async () => {
    await admin.change(ADMIN, { [STORAGE_SETTING.maxMb]: 2, [STORAGE_SETTING.allowedTypes]: ["application/pdf"] });
    expect(await rules()).toMatchObject({ maxBytes: 2 * MB, types: ["application/pdf"] });
    const lines = await admin.recent(ADMIN);
    expect(lines.map((l) => [l.action, l.targetId, l.actorId, l.actorLabel]).sort()).toEqual([
      ["storage.settings.changed", "storage.allowedTypes", ADMIN_ID, "admin@example.com"],
      ["storage.settings.changed", "storage.maxMb", ADMIN_ID, "admin@example.com"],
    ]);
    expect(lines.find((l) => l.targetId === STORAGE_SETTING.maxMb)?.detail).toEqual({ before: 25, after: 2 });
  });

  it("writes no line for a value that did not change", async () => {
    const before = (await admin.recent(ADMIN)).length;
    await admin.change(ADMIN, { [STORAGE_SETTING.maxMb]: 2 });
    expect(await admin.recent(ADMIN)).toHaveLength(before);
  });

  it("shows every setting with its bounds for the screen", async () => {
    const view = await admin.current(ADMIN);
    expect(view.find((s) => s.key === STORAGE_SETTING.maxMb)).toMatchObject({
      value: 2,
      default: 25,
      min: 1,
      max: 100,
    });
    expect(view.map((s) => s.key).sort()).toEqual(Object.values(STORAGE_SETTING).sort());
  });

  it("sets the quota of a product's space (bytes, objects) within bounds, applied at once and audited", async () => {
    for (const bad of [{ [STORAGE_SETTING.quotaMb]: 0 }, { [STORAGE_SETTING.quotaObjects]: 10_000_001 }])
      await expect(admin.change(ADMIN, bad)).rejects.toMatchObject({ code: STORAGE_ADMIN_ERROR.invalid });
    await admin.change(ADMIN, { [STORAGE_SETTING.quotaMb]: 3, [STORAGE_SETTING.quotaObjects]: 7 });
    expect(await rules()).toMatchObject({ quotaBytes: 3 * MB, quotaObjects: 7 });
    expect((await admin.recent(ADMIN)).map((e) => e.targetId)).toEqual(
      expect.arrayContaining([STORAGE_SETTING.quotaMb, STORAGE_SETTING.quotaObjects]),
    );
  });
});
