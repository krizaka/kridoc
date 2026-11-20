import { type MalwareScanner, type ObjectStore } from "@krizaka/storage";

import { documentAuditOf, documentKeyOf, isDocumentId } from "./document-address";
import {
  INTAKE_OUTCOME,
  type IntakeOutcome,
  quarantineKeyOf,
  type ScreenedFile,
  screenQuarantined,
} from "./document-intake";
import type { DocumentRecord, DocumentStore, OwnerObjects } from "./document-port";
import { DOCUMENT_ERROR, DocumentError } from "./errors";
import { unlessShredded } from "./shredded-reads";
import { AUDIT_ACTOR, STORAGE_AUDIT, type StorageAudit, type StorageAuditAction } from "./storage-audit";
import type { StorageRulesSource } from "./storage-settings";

export interface DocumentServiceDeps {
  documents: DocumentStore;
  /** The bytes, one sealed store per owner (envelope encryption per account, lib/storage/document-vault.ts). */
  objects: OwnerObjects;
  /** The quarantine every upload lands in first, and the scanner that clears it (clamd locally, GuardDuty later): nothing is a document before the scan. */
  quarantine: ObjectStore;
  scanner: MalwareScanner;
  newId: () => string;
  /** The administrator's rules (size, and the types the BYTES may be by magic number), read on every upload: a change applies at once. */
  rules: StorageRulesSource;
  /** One line per upload, read and delete: the account, its tenant, the key's hash. */
  audit: StorageAudit;
}

/** A file as the route read it: the bytes, the name it arrived with, the title the person gave (if any). */
export interface DocumentFile {
  bytes: Uint8Array;
  name: string;
  title?: string;
}

/** A document as the API answers it: never the owner, never the key. */
export interface DocumentView {
  id: string;
  title: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
}

// @fixed: the title column's bound (infra/migrations/2026-11-15-document-metadata.sql)
const TITLE_MAX = 200;
// @fixed: the title of a file that arrives with neither a title nor a name
const UNTITLED = "Document";

/** Where a document's bytes live in its owner's store (itself under the owner's prefix): by id, never by a name the client chose. */

export const documentView = (record: DocumentRecord): DocumentView => ({
  id: record.id,
  title: record.title,
  mediaType: record.mediaType,
  sizeBytes: record.sizeBytes,
  createdAt: record.createdAt.toISOString(),
});

const titleOf = (file: Omit<DocumentFile, "bytes">): string =>
  (file.title?.trim() || file.name.trim() || UNTITLED).slice(0, TITLE_MAX);

const notFound = () => new DocumentError(DOCUMENT_ERROR.notFound);

export interface DocumentService {
  /**
   * The intake: the bytes land in the quarantine, then size (HEAD, before any read), type by magic number, scan, seal and copy to the owner's
   * documents, quarantine deleted. @throws DocumentError `FILE_TOO_BIG`, `FILE_TYPE_REFUSED`, `FILE_INFECTED` (refused and gone),
   * `SCANNER_UNAVAILABLE` (503: kept in quarantine, never published)
   */
  upload(ownerId: string, file: DocumentFile): Promise<DocumentRecord>;
  /**
   * The same intake for a file that is already in the owner's quarantine under `id` (a direct upload to the quarantine, bounded by the provider):
   * the size is read from a HEAD before any byte is read. Same refusals as `upload`.
   */
  admit(ownerId: string, id: string, file: Omit<DocumentFile, "bytes">): Promise<DocumentRecord>;
  list(ownerId: string): Promise<DocumentRecord[]>;
  /** @throws DocumentError `DOCUMENT_NOT_FOUND` for a document that is not the owner's: another's is not even named. */
  read(ownerId: string, id: string): Promise<{ record: DocumentRecord; bytes: Uint8Array }>;
  /** @throws DocumentError `DOCUMENT_NOT_FOUND` for a document that is not the owner's. */
  remove(ownerId: string, id: string): Promise<void>;
  /**
   * Erasing an account (Law 25): the owner's key is shredded first, so every copy of their documents is unreadable at once (the
   * bucket's, a replica's, a backup's), then their objects are deleted. Idempotent: an erasure that stopped half-way is run again.
   * The metadata rows go with the account row (ON DELETE CASCADE).
   */
  eraseOwner(ownerId: string): Promise<void>;
}

/** The bytes of a document, or `null` when they are gone or can never open again (the owner's key was shredded). */
async function bytesOf(objects: OwnerObjects, ownerId: string, id: string): Promise<Uint8Array | null> {
  const object = await unlessShredded(() => objects.of(ownerId).get(documentKeyOf(id)), null);
  return object?.bytes ?? null;
}

/** One audit line of a document: who, which tenant, the key's hash and the detail (sizes and codes, never content). */
const noteOf = (
  deps: DocumentServiceDeps,
  action: StorageAuditAction,
  ownerId: string,
  id: string,
  detail?: Readonly<Record<string, number | string>>,
) =>
  deps.audit({
    action,
    actor: { kind: AUDIT_ACTOR.account, id: ownerId },
    ...documentAuditOf(ownerId, id),
    ...(detail === undefined ? {} : { detail }),
  });

/** Seals the screened bytes under the owner's key into the documents and records them; no metadata, no bytes: a failed insert leaves nothing behind. */
async function seal(
  deps: DocumentServiceDeps,
  ownerId: string,
  id: string,
  file: Omit<DocumentFile, "bytes">,
  screened: ScreenedFile,
): Promise<DocumentRecord> {
  const objects = deps.objects.of(ownerId);
  await objects.put(documentKeyOf(id), screened.bytes, { contentType: screened.mediaType });
  try {
    return await deps.documents.add({
      id,
      ownerId,
      title: titleOf(file),
      mediaType: screened.mediaType,
      sizeBytes: screened.bytes.byteLength,
    });
  } catch (error) {
    await objects.delete(documentKeyOf(id));
    throw error;
  }
}

/** The checks of the intake on what waits in the owner's quarantine under `id`, then the seal into the documents and the quarantine's deletion. */
async function admitQuarantined(
  deps: DocumentServiceDeps,
  ownerId: string,
  id: string,
  file: Omit<DocumentFile, "bytes">,
): Promise<DocumentRecord> {
  const pending = quarantineKeyOf(ownerId, id);
  const note = async (outcome: IntakeOutcome, code: string) =>
    noteOf(
      deps,
      outcome === INTAKE_OUTCOME.held ? STORAGE_AUDIT.intakeHeld : STORAGE_AUDIT.intakeRefused,
      ownerId,
      id,
      { code },
    );
  const screened = await screenQuarantined(
    { quarantine: deps.quarantine, scanner: deps.scanner, rules: deps.rules, note },
    pending,
  );
  const record = await seal(deps, ownerId, id, file, screened);
  await deps.quarantine.delete(pending);
  await noteOf(deps, STORAGE_AUDIT.uploaded, ownerId, id, { size: screened.bytes.byteLength });
  return record;
}

/**
 * Kridoc's own documents: the metadata in the database (`DocumentStore`), the bytes in each owner's sealed store (`OwnerObjects`).
 * Every read starts from the owner's metadata, so a person reaches only their own documents. Ports in, typed `DocumentError` out.
 */
export function createDocumentService(deps: DocumentServiceDeps): DocumentService {
  const note = (action: StorageAuditAction, ownerId: string, id: string, size?: number) =>
    noteOf(deps, action, ownerId, id, size === undefined ? undefined : { size });
  const ownRecord = async (ownerId: string, id: string): Promise<DocumentRecord> => {
    const record = isDocumentId(id) ? await deps.documents.findForOwner(ownerId, id) : null;
    if (!record) throw notFound();
    return record;
  };
  return {
    async upload(ownerId, file) {
      const id = deps.newId();
      const rules = await deps.rules();
      // The byte count is known before anything is written: a file already too big never enters the quarantine.
      if (file.bytes.byteLength === 0 || file.bytes.byteLength > rules.maxBytes)
        throw new DocumentError(DOCUMENT_ERROR.tooBig);
      await deps.quarantine.put(quarantineKeyOf(ownerId, id), file.bytes, { contentType: "application/octet-stream" });
      return admitQuarantined(deps, ownerId, id, file);
    },
    admit: (ownerId, id, file) => admitQuarantined(deps, ownerId, id, file),
    list: (ownerId) => deps.documents.listByOwner(ownerId),
    async read(ownerId, id) {
      const record = await ownRecord(ownerId, id);
      const bytes = await bytesOf(deps.objects, ownerId, id);
      if (!bytes) throw notFound();
      await note(STORAGE_AUDIT.read, ownerId, id, bytes.byteLength);
      return { record, bytes };
    },
    async remove(ownerId, id) {
      await ownRecord(ownerId, id);
      // The metadata first: once it is gone nobody reaches the bytes, and a failed delete of the bytes leaves an orphan the sweep finds.
      await deps.documents.removeForOwner(ownerId, id);
      await deps.objects.of(ownerId).delete(documentKeyOf(id));
      await note(STORAGE_AUDIT.deleted, ownerId, id);
    },
    async eraseOwner(ownerId) {
      await deps.objects.shred(ownerId);
      const objects = deps.objects.of(ownerId);
      for (const object of await objects.list("")) await objects.delete(object.key);
    },
  };
}
