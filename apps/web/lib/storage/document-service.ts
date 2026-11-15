import { sniffType, STORAGE_CODE, StorageError } from "@krizaka/storage";
import { z } from "zod";

import type { DocumentRecord, DocumentStore, OwnerObjects } from "./document-port";
import { DOCUMENT_ERROR, DocumentError } from "./errors";

/** The rules every document obeys, passed in (SETTINGS.documents today, the admin's settings later). */
export interface DocumentLimits {
  maxBytes: number;
  /** The types the BYTES may be (magic number), whatever the name or the declared type say. */
  types: readonly string[];
}

export interface DocumentServiceDeps {
  documents: DocumentStore;
  /** The bytes, one sealed store per owner (envelope encryption per account, lib/storage/document-vault.ts). */
  objects: OwnerObjects;
  newId: () => string;
  limits: DocumentLimits;
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
export const objectKeyOf = (id: string): string => `documents/${id}`;

export const documentView = (record: DocumentRecord): DocumentView => ({
  id: record.id,
  title: record.title,
  mediaType: record.mediaType,
  sizeBytes: record.sizeBytes,
  createdAt: record.createdAt.toISOString(),
});

const titleOf = (file: DocumentFile): string =>
  (file.title?.trim() || file.name.trim() || UNTITLED).slice(0, TITLE_MAX);

const notFound = () => new DocumentError(DOCUMENT_ERROR.notFound);
const isId = (id: string): boolean => z.uuid().safeParse(id).success;

/** The type of a file's bytes when the rules accept them. */
function acceptedType(bytes: Uint8Array, limits: DocumentLimits): string {
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxBytes) throw new DocumentError(DOCUMENT_ERROR.tooBig);
  const type = sniffType(bytes);
  if (type === null || !limits.types.includes(type)) throw new DocumentError(DOCUMENT_ERROR.badType);
  return type;
}

export interface DocumentService {
  upload(ownerId: string, file: DocumentFile): Promise<DocumentRecord>;
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
  try {
    return (await objects.of(ownerId).get(objectKeyOf(id)))?.bytes ?? null;
  } catch (error) {
    if (error instanceof StorageError && error.code === STORAGE_CODE.shredded) return null;
    throw error;
  }
}

/**
 * Kridoc's own documents: the metadata in the database (`DocumentStore`), the bytes in each owner's sealed store (`OwnerObjects`).
 * Every read starts from the owner's metadata, so a person reaches only their own documents. Ports in, typed `DocumentError` out.
 */
export function createDocumentService(deps: DocumentServiceDeps): DocumentService {
  const ownRecord = async (ownerId: string, id: string): Promise<DocumentRecord> => {
    const record = isId(id) ? await deps.documents.findForOwner(ownerId, id) : null;
    if (!record) throw notFound();
    return record;
  };
  return {
    async upload(ownerId, file) {
      const mediaType = acceptedType(file.bytes, deps.limits);
      const id = deps.newId();
      const key = objectKeyOf(id);
      const objects = deps.objects.of(ownerId);
      await objects.put(key, file.bytes, { contentType: mediaType });
      try {
        return await deps.documents.add({
          id,
          ownerId,
          title: titleOf(file),
          mediaType,
          sizeBytes: file.bytes.byteLength,
        });
      } catch (error) {
        // No metadata, no bytes: a failed insert leaves nothing behind.
        await objects.delete(key);
        throw error;
      }
    },
    list: (ownerId) => deps.documents.listByOwner(ownerId),
    async read(ownerId, id) {
      const record = await ownRecord(ownerId, id);
      const bytes = await bytesOf(deps.objects, ownerId, id);
      if (!bytes) throw notFound();
      return { record, bytes };
    },
    async remove(ownerId, id) {
      await ownRecord(ownerId, id);
      // The metadata first: once it is gone nobody reaches the bytes, and a failed delete of the bytes leaves an orphan the sweep finds.
      await deps.documents.removeForOwner(ownerId, id);
      await deps.objects.of(ownerId).delete(objectKeyOf(id));
    },
    async eraseOwner(ownerId) {
      await deps.objects.shred(ownerId);
      const objects = deps.objects.of(ownerId);
      for (const object of await objects.list("")) await objects.delete(object.key);
    },
  };
}
