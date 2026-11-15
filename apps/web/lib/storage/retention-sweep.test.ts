import { randomBytes } from "node:crypto";

import { memoryObjectStore, memoryTenantKeyStore, type ObjectStore } from "@krizaka/storage";
import { beforeEach, describe, expect, it } from "vitest";

import type { OwnerObjects } from "./document-port";
import { objectKeyOf } from "./document-service";
import { accountTenantOf, ownerObjectsOf } from "./document-vault";
import type { RetentionStore, SweepCursor, SweepDocument } from "./retention-port";
import { type SweepDeps, sweepStorage } from "./retention-sweep";
import type { StorageAuditLine } from "./storage-audit";

const NOW = new Date("2026-11-15T12:00:00Z");
const DAY = 86_400_000;
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const owner = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const doc = (n: number) => `00000000-0000-4000-8000-1000000000${String(n).padStart(2, "0")}`;

interface Row extends SweepDocument {
  createdAt: Date;
}

/** The retention port in memory, with the semantics of lib/db/retention-store.ts (tested on PostgreSQL). */
function memoryRetentionStore(rows: Row[], owners: string[]): RetentionStore & { existingCalls: string[] } {
  const existingCalls: string[] = [];
  return {
    existingCalls,
    expired: async (cutoff, limit) =>
      rows
        .filter((r) => r.createdAt < cutoff)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit),
    async remove(document) {
      const at = rows.findIndex((r) => r.id === document.id && r.ownerId === document.ownerId);
      if (at < 0) return false;
      rows.splice(at, 1);
      return true;
    },
    ownersAfter: async (cursor, limit) =>
      [...owners]
        .sort()
        .filter((o) => cursor === null || o > cursor)
        .slice(0, limit),
    async existing(ownerId, ids) {
      existingCalls.push(...ids);
      return new Set(rows.filter((r) => r.ownerId === ownerId && ids.includes(r.id)).map((r) => r.id));
    },
  };
}

describe("the retention sweep", () => {
  let installation: ObjectStore;
  let objects: OwnerObjects;
  let rows: Row[];
  let store: ReturnType<typeof memoryRetentionStore>;
  let cursorValue: string | null;
  let audit: StorageAuditLine[];
  let retentionDays: number;
  let deps: SweepDeps;
  const cursor: SweepCursor = {
    read: async () => cursorValue,
    async write(value) {
      cursorValue = value;
    },
  };

  const put = (ownerId: string, id: string) =>
    objects.of(ownerId).put(objectKeyOf(id), PDF, { contentType: "application/pdf" });
  const keysOf = async (ownerId: string) => (await objects.of(ownerId).list("")).map((o) => o.key).sort();

  beforeEach(() => {
    installation = memoryObjectStore();
    objects = ownerObjectsOf(installation, {
      rootKey: randomBytes(32).toString("base64"),
      keys: memoryTenantKeyStore(),
      clock: { now: () => NOW },
      audit: async () => {},
    });
    rows = [];
    cursorValue = null;
    audit = [];
    retentionDays = 365;
    store = memoryRetentionStore(rows, [owner(1), owner(2), owner(3)]);
    deps = {
      store,
      cursor,
      objects,
      rules: async () => ({ maxBytes: 1, types: [], signedUrlSeconds: 1, retentionDays }),
      audit: async (line) => {
        audit.push(line);
      },
      clock: { now: () => NOW },
      limits: { expired: 100, owners: 100, objectsPerOwner: 100 },
    };
  });

  const keep = async (n: number, ownerId: string, ageDays: number) => {
    rows.push({ id: doc(n), ownerId, createdAt: new Date(NOW.getTime() - ageDays * DAY) });
    await put(ownerId, doc(n));
  };

  it("removes the documents past the administrator's retention, row and bytes, and keeps the others", async () => {
    await keep(1, owner(1), 400);
    await keep(2, owner(1), 10);
    const result = await sweepStorage(deps);
    expect(result.expired).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([doc(2)]);
    expect(await keysOf(owner(1))).toEqual([objectKeyOf(doc(2))]);
  });

  it("follows a retention that was lowered since the last run", async () => {
    await keep(1, owner(1), 40);
    expect((await sweepStorage(deps)).expired).toBe(0);
    retentionDays = 30;
    expect((await sweepStorage(deps)).expired).toBe(1);
    expect(await keysOf(owner(1))).toEqual([]);
  });

  it("removes the objects that have no row, and never a document with a row or a key that is not a document's", async () => {
    await keep(1, owner(1), 1);
    await put(owner(1), doc(9)); // bytes whose insert never happened
    await objects.of(owner(1)).put("avatars/me.png", PDF, { contentType: "application/pdf" });
    const result = await sweepStorage(deps);
    expect(result.orphans).toBe(1);
    expect(await keysOf(owner(1))).toEqual(["avatars/me.png", objectKeyOf(doc(1))]);
    expect(audit.find((l) => l.detail?.reason === "orphan")).toMatchObject({ action: "storage.deleted" });
  });

  it("spares an object whose row appears between the first look and the delete (an upload in flight)", async () => {
    await put(owner(1), doc(9));
    const original = store.existing.bind(store);
    let calls = 0;
    store.existing = async (ownerId, ids) => {
      calls += 1;
      if (calls === 2) rows.push({ id: doc(9), ownerId, createdAt: NOW });
      return original(ownerId, ids);
    };
    expect((await sweepStorage(deps)).orphans).toBe(0);
    expect(await keysOf(owner(1))).toEqual([objectKeyOf(doc(9))]);
  });

  it("is bounded: at most the limit of expired documents per run, the rest at the next", async () => {
    for (let n = 1; n <= 5; n += 1) await keep(n, owner(1), 400 + n);
    deps.limits = { ...deps.limits, expired: 2 };
    expect((await sweepStorage(deps)).expired).toBe(2);
    expect(rows).toHaveLength(3);
    await sweepStorage(deps);
    await sweepStorage(deps);
    expect(rows).toHaveLength(0);
  });

  it("checks a bounded batch of owners per run, resumes after the last, and wraps at the end", async () => {
    for (const n of [1, 2, 3]) await put(owner(n), doc(n));
    deps.limits = { ...deps.limits, owners: 2 };
    expect((await sweepStorage(deps)).owners).toBe(2);
    expect(cursorValue).toBe(owner(2));
    expect(await keysOf(owner(3))).toEqual([objectKeyOf(doc(3))]);
    expect((await sweepStorage(deps)).owners).toBe(1);
    expect(cursorValue).toBeNull();
    expect(await keysOf(owner(3))).toEqual([]);
    expect((await sweepStorage(deps)).owners).toBe(2);
  });

  it("looks at no more objects of one owner than the bound", async () => {
    for (let n = 1; n <= 4; n += 1) await put(owner(1), doc(n));
    deps.limits = { ...deps.limits, objectsPerOwner: 3 };
    expect((await sweepStorage(deps)).orphans).toBe(3);
    expect(await keysOf(owner(1))).toHaveLength(1);
  });

  it("fails closed: when the rules cannot be read nothing is deleted, not even an orphan", async () => {
    await keep(1, owner(1), 4000);
    await put(owner(1), doc(9));
    deps.rules = async () => {
      throw new Error("the settings are unreachable");
    };
    await expect(sweepStorage(deps)).rejects.toThrow("unreachable");
    expect(rows).toHaveLength(1);
    expect(await keysOf(owner(1))).toHaveLength(2);
    expect(audit).toEqual([]);
  });

  it("fails closed: a store that fails stops the run, and the next run finishes the job", async () => {
    await keep(1, owner(1), 400);
    await keep(2, owner(1), 401);
    const remove = store.remove.bind(store);
    let failures = 1;
    store.remove = async (document) => {
      if (document.id === doc(1) && failures-- > 0) throw new Error("the database is gone");
      return remove(document);
    };
    await expect(sweepStorage(deps)).rejects.toThrow("database");
    // doc(2) is older and went first (row and bytes); doc(1) is where the run stopped, whole.
    expect(rows.map((r) => r.id)).toEqual([doc(1)]);
    expect(await keysOf(owner(1))).toEqual([objectKeyOf(doc(1))]);
    await sweepStorage(deps);
    expect(rows).toHaveLength(0);
    expect(await keysOf(owner(1))).toEqual([]);
  });

  it("clears the leftovers of an owner whose key was shredded too, and audits by job, tenant and key hash only", async () => {
    await put(owner(1), doc(9));
    await objects.shred(owner(1));
    await put(owner(2), doc(8));
    const result = await sweepStorage(deps);
    expect(result.orphans).toBe(2);
    expect(await keysOf(owner(1))).toEqual([]);
    expect(audit.every((l) => l.actor.kind === "job")).toBe(true);
    expect(audit.map((l) => l.tenantId)).toContain(accountTenantOf(owner(2)));
    expect(JSON.stringify(audit)).not.toContain(doc(8));
  });
});
