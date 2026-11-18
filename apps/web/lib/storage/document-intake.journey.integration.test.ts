import { randomBytes } from "node:crypto";

import { bucketStore, memoryTenantKeyStore, type ObjectStore, scanDaemon } from "@krizaka/storage";
import { tcpScanTransport } from "@krizaka/storage/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { INTAKE_S3_KEYS, type IntakeServices, startIntakeServices, TEST_MARKER } from "@/tests/intake-services";

import { quarantineKeyOf } from "./document-intake";
import { createDocumentService, type DocumentService } from "./document-service";
import { ownerObjectsOf } from "./document-vault";
import { memoryDocumentStore } from "./memory-document-store";
import { platformFetch } from "./object-store";
import type { StorageAuditLine } from "./storage-audit";
import type { StorageRules } from "./storage-settings";

/**
 * The intake journey on a real S3 server and a real ClamAV daemon (official images pinned by digest, started by intake-services.ts):
 * quarantine, size, type, scan, seal, documents. Never skipped: it needs the Docker CLI.
 */
const OWNER = "00000000-0000-4000-8000-00000000000a";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
// The industry's standard antivirus test string (EICAR): harmless, every scanner flags it. Held in two pieces so no scanner flags this file.
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$` + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const eicarFile = () => new TextEncoder().encode(EICAR);
const markedPdf = () => new TextEncoder().encode(`%PDF-1.7\n${TEST_MARKER}\n%%EOF\n`);
const RULES: StorageRules = {
  maxBytes: 1024 * 1024,
  types: ["application/pdf"],
  signedUrlSeconds: 300,
  retentionDays: 365,
  quotaBytes: 1_000_000,
  quotaObjects: 1000,
  scanTimeoutSeconds: 30,
};
const QUARANTINE = "kridoc-quarantine";
const DOCUMENTS = "kridoc-documents";

describe("the intake of a document, on S3 and clamd", () => {
  let services: IntakeServices;
  let quarantine: ObjectStore;
  let documentsBucket: ObjectStore;
  let reads: string[];
  let audit: StorageAuditLine[];
  let service: DocumentService;
  let rules: StorageRules;
  let ids: number;

  const bucket = (name: string) =>
    bucketStore({
      endpoint: services.s3Endpoint,
      region: "us-east-1",
      bucket: name,
      ...INTAKE_S3_KEYS,
      fetch: platformFetch,
      clock: { now: () => new Date() },
    });
  const build = (scanner: "up" | "down") => {
    const store = bucket(QUARANTINE);
    quarantine = { ...store, get: async (key) => (reads.push(key), store.get(key)) };
    const port = scanner === "up" ? services.clamd.port : 1;
    service = createDocumentService({
      documents: memoryDocumentStore(),
      quarantine,
      scanner: scanDaemon({
        store: quarantine,
        transport: tcpScanTransport({ host: services.clamd.host, port }),
      }),
      objects: ownerObjectsOf(documentsBucket, {
        rootKey: randomBytes(32).toString("base64"),
        keys: memoryTenantKeyStore(),
        clock: { now: () => new Date() },
        audit: async () => {},
      }),
      newId: () => `00000000-0000-4000-8000-2000000000${String(++ids).padStart(2, "0")}`,
      rules: async () => rules,
      audit: async (line) => {
        audit.push(line);
      },
    });
  };
  const emptied = async (store: ObjectStore) => {
    for (const object of await store.list("")) await store.delete(object.key);
  };

  beforeAll(async () => {
    services = await startIntakeServices([QUARANTINE, DOCUMENTS]);
    documentsBucket = bucket(DOCUMENTS);
  }, 300_000);
  afterAll(() => services?.stop());

  const fresh = async (scanner: "up" | "down" = "up") => {
    reads = [];
    audit = [];
    ids = 0;
    rules = RULES;
    build(scanner);
    await emptied(quarantine);
    await emptied(documentsBucket);
  };

  it("a clean file goes quarantine → scan → sealed in the documents, and the quarantine is empty", async () => {
    await fresh();
    const record = await service.upload(OWNER, { bytes: PDF, name: "bail.pdf" });
    expect(record).toMatchObject({ ownerId: OWNER, mediaType: "application/pdf", sizeBytes: PDF.byteLength });
    expect(await quarantine.list("")).toEqual([]);
    const sealed = await documentsBucket.list("");
    expect(sealed).toHaveLength(1);
    const raw = await documentsBucket.get(sealed[0]!.key);
    expect(new TextDecoder("latin1").decode(raw!.bytes)).not.toContain("%PDF");
    expect((await service.read(OWNER, record.id)).bytes).toEqual(PDF);
    expect(audit.map((line) => line.action)).toContain("storage.uploaded");
  });

  it("EICAR is refused and gone: nothing in the quarantine, nothing in the documents, no row", async () => {
    await fresh();
    await expect(service.upload(OWNER, { bytes: eicarFile(), name: "eicar.txt" })).rejects.toMatchObject({
      code: "FILE_TYPE_REFUSED",
    });
    expect(await quarantine.list("")).toEqual([]);
    expect(await documentsBucket.list("")).toEqual([]);
    expect(await service.list(OWNER)).toEqual([]);
  });

  it("the daemon itself flags EICAR in the quarantine's object", async () => {
    await fresh();
    const key = quarantineKeyOf(OWNER, "00000000-0000-4000-8000-4000000000bb");
    await quarantine.put(key, eicarFile(), { contentType: "application/octet-stream" });
    const verdict = await scanDaemon({
      store: quarantine,
      transport: tcpScanTransport(services.clamd),
    }).scan({ key });
    expect(verdict).toEqual({ status: "infected", name: "Eicar-Test-Signature" });
  });

  it("an infected file that passed the type check is refused and gone: no quarantine, no document, no row", async () => {
    await fresh();
    await expect(service.upload(OWNER, { bytes: markedPdf(), name: "invoice.pdf" })).rejects.toMatchObject({
      code: "FILE_INFECTED",
    });
    expect(await quarantine.list("")).toEqual([]);
    expect(await documentsBucket.list("")).toEqual([]);
    expect(await service.list(OWNER)).toEqual([]);
    expect(audit).toMatchObject([{ action: "storage.intake.refused", detail: { code: "FILE_INFECTED" } }]);
  });

  it("an oversize file is refused from its size, before one byte of it is read, and removed", async () => {
    await fresh();
    rules = { ...RULES, maxBytes: 64 };
    // A client that went round the provider's bound: the bytes are in the quarantine already.
    await quarantine.put(quarantineKeyOf(OWNER, "00000000-0000-4000-8000-3000000000aa"), new Uint8Array(65), {
      contentType: "application/octet-stream",
    });
    await expect(
      service.admit(OWNER, "00000000-0000-4000-8000-3000000000aa", { name: "big.pdf" }),
    ).rejects.toMatchObject({ code: "FILE_TOO_BIG" });
    expect(reads).toEqual([]);
    expect(await quarantine.list("")).toEqual([]);
    expect(await documentsBucket.list("")).toEqual([]);
  });

  it("a scanner that is down keeps the file in quarantine, answers 503 and never publishes it", async () => {
    await fresh("down");
    await expect(service.upload(OWNER, { bytes: PDF, name: "bail.pdf" })).rejects.toMatchObject({
      code: "SCANNER_UNAVAILABLE",
    });
    expect(await quarantine.list("")).toHaveLength(1);
    expect(await documentsBucket.list("")).toEqual([]);
    expect(await service.list(OWNER)).toEqual([]);
    expect(audit).toMatchObject([{ action: "storage.intake.held", detail: { code: "SCANNER_UNAVAILABLE" } }]);
  });
});
