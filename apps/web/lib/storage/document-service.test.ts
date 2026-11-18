import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memoryMalwareScanner, memoryObjectStore, memoryTenantKeyStore, type ObjectStore } from "@krizaka/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OwnerObjects } from "./document-port";
import { createDocumentService, type DocumentService, documentView, objectKeyOf } from "./document-service";
import { accountTenantOf, ownerObjectsOf } from "./document-vault";
import { memoryDocumentStore } from "./memory-document-store";
import { objectStoreOf } from "./object-store";
import { STORAGE_PROVIDER } from "./providers";
import type { StorageAuditLine } from "./storage-audit";
import type { StorageRules } from "./storage-settings";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const TEXT = new TextEncoder().encode("just some words, not a document type Kridoc keeps");
const AT = new Date("2026-11-15T10:00:00Z");
const RULES: StorageRules = {
  maxBytes: 25 * 1024 * 1024,
  types: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  signedUrlSeconds: 300,
  retentionDays: 365,
  quotaBytes: 1_000_000,
  quotaObjects: 1000,
  scanTimeoutSeconds: 30,
};

describe("Kridoc's documents on the local adapter", () => {
  let root: string;
  let bucket: ObjectStore;
  let quarantine: ReturnType<typeof memoryObjectStore>;
  let objects: OwnerObjects;
  let documents: ReturnType<typeof memoryDocumentStore>;
  let service: DocumentService;
  let ids: number;
  let rules: StorageRules;
  let audit: StorageAuditLine[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kridoc-documents-"));
    bucket = objectStoreOf(
      { provider: STORAGE_PROVIDER.local, tenant: "kridoc-test", root },
      {
        fetch: async () => {
          throw new Error("the local adapter never calls the network");
        },
        clock: { now: () => AT },
      },
    );
    objects = ownerObjectsOf(bucket, {
      rootKey: randomBytes(32).toString("base64"),
      keys: memoryTenantKeyStore(),
      clock: { now: () => AT },
      audit: async () => {},
    });
    documents = memoryDocumentStore();
    ids = 0;
    rules = RULES;
    audit = [];
    quarantine = memoryObjectStore();
    service = createDocumentService({
      documents,
      objects,
      quarantine,
      scanner: memoryMalwareScanner(quarantine),
      newId: () => `00000000-0000-4000-8000-1000000000${String(++ids).padStart(2, "0")}`,
      rules: async () => rules,
      audit: async (line) => {
        audit.push(line);
      },
    });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps a document, lists it and gives its bytes back to its owner", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "bail.pdf", title: "  Bail 2026  " });
    expect(record).toMatchObject({
      ownerId: A,
      title: "Bail 2026",
      mediaType: "application/pdf",
      sizeBytes: PDF.byteLength,
    });
    expect((await service.list(A)).map((r) => r.id)).toEqual([record.id]);
    const read = await service.read(A, record.id);
    expect([...read.bytes]).toEqual([...PDF]);
    expect(documentView(record)).toEqual({
      id: record.id,
      title: "Bail 2026",
      mediaType: "application/pdf",
      sizeBytes: PDF.byteLength,
      createdAt: AT.toISOString(),
    });
  });

  it("never lets user B read, list or delete user A's document", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "bail.pdf" });
    await expect(service.read(B, record.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(service.remove(B, record.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(await service.list(B)).toEqual([]);
    expect([...(await service.read(A, record.id)).bytes]).toEqual([...PDF]);
  });

  it("keeps the bytes by owner and id, sealed under the owner's key, inside the installation's tenant folder", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "../../etc/passwd" });
    expect(record.title).toBe("../../etc/passwd");
    expect(await objects.of(A).head(objectKeyOf(record.id))).toEqual({
      key: objectKeyOf(record.id),
      size: PDF.byteLength,
    });
    const onDisk = await readFile(join(root, "kridoc-test", "t", accountTenantOf(A), "documents", record.id));
    expect(onDisk.includes(Buffer.from("%PDF"))).toBe(false);
    expect(onDisk.byteLength).toBeGreaterThan(PDF.byteLength);
  });

  it("erases an account: its key is shredded first, its objects are gone, its documents never open again; B is untouched", async () => {
    const mine = await service.upload(A, { bytes: PDF, name: "bail.pdf" });
    const theirs = await service.upload(B, { bytes: PDF, name: "bail.pdf" });
    await service.eraseOwner(A);
    expect(await bucket.list(`t/${accountTenantOf(A)}/`)).toEqual([]);
    // The metadata row goes with the account (ON DELETE CASCADE); until then the document reads as « not found ».
    await expect(service.read(A, mine.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(objects.of(A).put("documents/x", PDF, { contentType: "application/pdf" })).rejects.toMatchObject({
      code: "STORAGE_TENANT_SHREDDED",
    });
    expect([...(await service.read(B, theirs.id)).bytes]).toEqual([...PDF]);
    // Idempotent: an erasure that stopped half-way is run again.
    await expect(service.eraseOwner(A)).resolves.toBeUndefined();
  });

  it("answers « not found » for a document whose owner's key was shredded but whose bytes are still in the bucket", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "bail.pdf" });
    await objects.shred(A);
    await expect(service.read(A, record.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("deletes the metadata and the bytes; a second delete is « not found »", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "bail.pdf" });
    await service.remove(A, record.id);
    expect(await objects.of(A).get(objectKeyOf(record.id))).toBeNull();
    expect(await service.list(A)).toEqual([]);
    await expect(service.remove(A, record.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(service.read(A, record.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("refuses bytes of a type it does not keep, an empty file and one over the limit, and stores nothing", async () => {
    await expect(service.upload(A, { bytes: TEXT, name: "fake.pdf" })).rejects.toMatchObject({
      code: "FILE_TYPE_REFUSED",
    });
    await expect(service.upload(A, { bytes: new Uint8Array(), name: "empty.pdf" })).rejects.toMatchObject({
      code: "FILE_TOO_BIG",
    });
    const small = createDocumentService({
      documents,
      objects,
      quarantine,
      scanner: memoryMalwareScanner(quarantine),
      newId: () => "00000000-0000-4000-8000-200000000001",
      rules: async () => ({ ...rules, maxBytes: 8 }),
      audit: async () => {},
    });
    await expect(small.upload(A, { bytes: PDF, name: "bail.pdf" })).rejects.toMatchObject({ code: "FILE_TOO_BIG" });
    expect(await bucket.list("")).toEqual([]);
    expect(await service.list(A)).toEqual([]);
  });

  it("reads the rules on every upload: a lowered limit or a removed type refuses the next file at once", async () => {
    await service.upload(A, { bytes: PDF, name: "one.pdf" });
    rules = { ...RULES, maxBytes: PDF.byteLength - 1 };
    await expect(service.upload(A, { bytes: PDF, name: "two.pdf" })).rejects.toMatchObject({ code: "FILE_TOO_BIG" });
    rules = { ...RULES, types: ["image/png"] };
    await expect(service.upload(A, { bytes: PDF, name: "three.pdf" })).rejects.toMatchObject({
      code: "FILE_TYPE_REFUSED",
    });
    expect(await service.list(A)).toHaveLength(1);
  });

  it("audits the upload, the read and the delete by account and tenant, never by title or key", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "secret-lease.pdf" });
    await service.read(A, record.id);
    await service.remove(A, record.id);
    expect(audit.map((l) => l.action)).toEqual(["storage.uploaded", "storage.read", "storage.deleted"]);
    expect(
      audit.every((l) => l.actor.kind === "account" && l.actor.id === A && l.tenantId === accountTenantOf(A)),
    ).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("secret-lease");
    expect(JSON.stringify(audit)).not.toContain(record.id);
  });

  it("removes the bytes when the metadata cannot be written", async () => {
    documents.failNextAdd();
    await expect(service.upload(A, { bytes: PDF, name: "bail.pdf" })).rejects.toThrow(
      "the database refused the insert",
    );
    expect(await bucket.list("")).toEqual([]);
  });

  it("answers « not found » for an id that is not a document id, without asking the database", async () => {
    for (const id of ["", "not-a-uuid", "../x", "' OR 1=1 --"])
      await expect(service.read(A, id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("names a file that arrives with no title and no name « Document »", async () => {
    expect((await service.upload(A, { bytes: PDF, name: "  " })).title).toBe("Document");
  });
});
