import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObjectStore } from "@krizaka/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETTINGS } from "@/lib/env";

import type { DocumentRecord, DocumentStore, NewDocument } from "./document-port";
import { createDocumentService, type DocumentService, documentView, objectKeyOf } from "./document-service";
import { objectStoreOf } from "./object-store";
import { STORAGE_PROVIDER } from "./providers";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const TEXT = new TextEncoder().encode("just some words, not a document type Kridoc keeps");
const AT = new Date("2026-11-15T10:00:00Z");

/** The metadata port in memory, with the same owner rule as the SQL adapter (lib/db/document-store.ts, tested on PostgreSQL). */
function memoryDocumentStore(): DocumentStore & { failNextAdd(): void } {
  const rows = new Map<string, DocumentRecord>();
  let fail = false;
  return {
    failNextAdd: () => {
      fail = true;
    },
    async add(document: NewDocument) {
      if (fail) {
        fail = false;
        throw new Error("the database refused the insert");
      }
      const record = { ...document, id: document.id ?? `id-${rows.size}`, createdAt: AT };
      rows.set(record.id, record);
      return record;
    },
    listByOwner: async (ownerId) => [...rows.values()].filter((r) => r.ownerId === ownerId),
    findForOwner: async (ownerId, id) => (rows.get(id)?.ownerId === ownerId ? rows.get(id)! : null),
    async removeForOwner(ownerId, id) {
      if (rows.get(id)?.ownerId !== ownerId) return false;
      return rows.delete(id);
    },
  };
}

describe("Kridoc's documents on the local adapter", () => {
  let root: string;
  let objects: ObjectStore;
  let documents: ReturnType<typeof memoryDocumentStore>;
  let service: DocumentService;
  let ids: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kridoc-documents-"));
    objects = objectStoreOf(
      { provider: STORAGE_PROVIDER.local, tenant: "kridoc-test", root },
      {
        fetch: async () => {
          throw new Error("the local adapter never calls the network");
        },
        clock: { now: () => AT },
      },
    );
    documents = memoryDocumentStore();
    ids = 0;
    service = createDocumentService({
      documents,
      objects,
      newId: () => `00000000-0000-4000-8000-1000000000${String(++ids).padStart(2, "0")}`,
      limits: SETTINGS.documents,
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

  it("keeps the bytes by owner and id, under the installation's tenant folder", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "../../etc/passwd" });
    expect(record.title).toBe("../../etc/passwd");
    expect(await objects.head(objectKeyOf(A, record.id))).toEqual({
      key: objectKeyOf(A, record.id),
      size: PDF.byteLength,
    });
    const onDisk = await readFile(join(root, "kridoc-test", "documents", A, record.id));
    expect([...onDisk]).toEqual([...PDF]);
  });

  it("deletes the metadata and the bytes; a second delete is « not found »", async () => {
    const record = await service.upload(A, { bytes: PDF, name: "bail.pdf" });
    await service.remove(A, record.id);
    expect(await objects.get(objectKeyOf(A, record.id))).toBeNull();
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
      newId: () => "00000000-0000-4000-8000-200000000001",
      limits: { maxBytes: 8, types: SETTINGS.documents.types },
    });
    await expect(small.upload(A, { bytes: PDF, name: "bail.pdf" })).rejects.toMatchObject({ code: "FILE_TOO_BIG" });
    expect(await objects.list("documents/")).toEqual([]);
    expect(await service.list(A)).toEqual([]);
  });

  it("removes the bytes when the metadata cannot be written", async () => {
    documents.failNextAdd();
    await expect(service.upload(A, { bytes: PDF, name: "bail.pdf" })).rejects.toThrow(
      "the database refused the insert",
    );
    expect(await objects.list("documents/")).toEqual([]);
  });

  it("answers « not found » for an id that is not a document id, without asking the database", async () => {
    for (const id of ["", "not-a-uuid", "../x", "' OR 1=1 --"])
      await expect(service.read(A, id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("names a file that arrives with no title and no name « Document »", async () => {
    expect((await service.upload(A, { bytes: PDF, name: "  " })).title).toBe("Document");
  });
});
