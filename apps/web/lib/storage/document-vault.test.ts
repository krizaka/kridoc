import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { emitMigration } from "@krizaka/db";
import { type KeyAuditNote, memoryObjectStore, memoryTenantKeyStore, type ObjectStore } from "@krizaka/storage";
import { storageSchema } from "@krizaka/storage/provider-admin";
import { describe, expect, it } from "vitest";

import { MIGRATIONS_DIR } from "@/lib/db/migrations";

import { accountTenantOf, ownerObjectsOf } from "./document-vault";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Title (Bail de Mira) >> endobj\n%%EOF\n");
const AT = new Date("2026-11-15T10:00:00Z");
const ROOT_KEY = randomBytes(32).toString("base64");
// @fixed: the dated file of the tenant keyring (infra/migrations)
const KEYRING_MIGRATION = "2026-11-17-tenant-keyring.sql";
const KEY = "documents/00000000-0000-4000-8000-100000000001";

/** The bucket as its key holder sees it (`inner`), and the owners' sealed stores over it. */
function setup(rootKey = ROOT_KEY) {
  const bucket: ObjectStore = memoryObjectStore();
  const notes: KeyAuditNote[] = [];
  const keys = memoryTenantKeyStore();
  const owners = ownerObjectsOf(bucket, {
    rootKey,
    keys,
    clock: { now: () => AT },
    audit: async (note) => {
      notes.push(note);
    },
  });
  return { bucket, keys, notes, owners };
}

const containsPlain = (sealed: Uint8Array): boolean => Buffer.from(sealed).includes(Buffer.from("Bail de Mira"));

describe("each account's documents under its own key (envelope encryption, krizaka-internal#3754)", () => {
  it("names an account's tenant from its id, never from a request", () => {
    expect(accountTenantOf(A)).toBe(`account-${A}`);
  });

  it("gives the bucket only ciphertext, under the account's own prefix", async () => {
    const { bucket, owners, notes } = setup();
    await owners.of(A).put(KEY, PDF, { contentType: "application/pdf" });
    const [stored] = await bucket.list("");
    expect(stored?.key).toBe(`t/account-${A}/${KEY}`);
    const raw = await bucket.get(stored!.key);
    expect(raw?.contentType).toBe("application/octet-stream");
    expect(containsPlain(raw!.bytes)).toBe(false);
    expect([...(await owners.of(A).get(KEY))!.bytes]).toEqual([...PDF]);
    expect(notes.map((n) => n.action)).toEqual(["storage.key.created"]);
  });

  it("never lets one account read another's object, even with the bucket key: a copy under its name does not open", async () => {
    const { bucket, owners } = setup();
    await owners.of(A).put(KEY, PDF, { contentType: "application/pdf" });
    await owners.of(B).put("documents/own", PDF, { contentType: "application/pdf" });
    // B cannot even name A's object: its keys live under its own prefix.
    expect(await owners.of(B).get(KEY)).toBeNull();
    // Whoever holds the bucket key copies A's sealed bytes under B's name: B's key does not open them.
    const sealed = await bucket.get(`t/account-${A}/${KEY}`);
    await bucket.put(`t/account-${B}/${KEY}`, sealed!.bytes, { contentType: "application/octet-stream" });
    await expect(owners.of(B).get(KEY)).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
    expect([...(await owners.of(A).get(KEY))!.bytes]).toEqual([...PDF]);
  });

  it("opens nothing under another root key (a bucket and its keyring taken to another deployment)", async () => {
    const first = setup();
    await first.owners.of(A).put(KEY, PDF, { contentType: "application/pdf" });
    const elsewhere = ownerObjectsOf(first.bucket, {
      rootKey: randomBytes(32).toString("base64"),
      keys: first.keys,
      clock: { now: () => AT },
      audit: async () => {},
    });
    await expect(elsewhere.of(A).get(KEY)).rejects.toMatchObject({ code: "STORAGE_UNREADABLE" });
  });

  it("shreds the account's key: its objects never open again, the copies included; another account is untouched", async () => {
    const { bucket, owners, keys, notes } = setup();
    await owners.of(A).put(KEY, PDF, { contentType: "application/pdf" });
    await owners.of(B).put(KEY, PDF, { contentType: "application/pdf" });
    const backup = await bucket.get(`t/account-${A}/${KEY}`);

    await owners.shred(A);

    expect(await keys.versions(accountTenantOf(A))).toEqual([]);
    expect(await keys.shreddedAt(accountTenantOf(A))).toEqual(AT);
    await expect(owners.of(A).get(KEY)).rejects.toMatchObject({ code: "STORAGE_TENANT_SHREDDED" });
    // A backup of the sealed bytes put back in the bucket opens no more than the original.
    await bucket.put(`t/account-${A}/${KEY}`, backup!.bytes, { contentType: "application/octet-stream" });
    await expect(owners.of(A).get(KEY)).rejects.toMatchObject({ code: "STORAGE_TENANT_SHREDDED" });
    // The erased account gets no new key either.
    await expect(owners.of(A).put("documents/new", PDF, { contentType: "application/pdf" })).rejects.toMatchObject({
      code: "STORAGE_TENANT_SHREDDED",
    });
    expect([...(await owners.of(B).get(KEY))!.bytes]).toEqual([...PDF]);
    expect(notes.at(-1)).toMatchObject({ action: "storage.key.shredded", target: { id: accountTenantOf(A) } });
  });

  it("refuses a root key that is not 32 bytes in base64, without showing it", () => {
    expect(() => setup("c2hvcnQ=")).toThrow(expect.objectContaining({ name: "StorageError" }));
    try {
      setup("c2hvcnQ=");
    } catch (error) {
      expect(String(error)).not.toContain("c2hvcnQ=");
    }
  });
});

describe("the tenant keyring migration", () => {
  it("is storageSchema v2 exactly as @krizaka/storage emits it (never edited by hand)", async () => {
    const sql = await readFile(`${MIGRATIONS_DIR}${KEYRING_MIGRATION}`, "utf8");
    expect(sql).toBe(emitMigration(storageSchema, 2, { tables: {} }));
  });
});
