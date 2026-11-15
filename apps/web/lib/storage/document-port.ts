/** The metadata of a stored document (the bytes live in object storage, not here). */
export interface DocumentRecord {
  id: string;
  ownerId: string;
  title: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: Date;
}

/** A new document; `id` when the caller chose it (the key of its bytes is made from it before the row exists). */
export type NewDocument = Pick<DocumentRecord, "ownerId" | "title" | "mediaType" | "sizeBytes"> & { id?: string };

/** The port: the only door to the document metadata. Services depend on this, never on SQL (the adapter is lib/db/document-store.ts). */
export interface DocumentStore {
  add(document: NewDocument): Promise<DocumentRecord>;
  /** The owner's documents, newest first, at most `limit` (never an unbounded read). */
  listByOwner(ownerId: string, limit?: number): Promise<DocumentRecord[]>;
  /** One document, only when it belongs to the owner (never another owner's). */
  findForOwner(ownerId: string, id: string): Promise<DocumentRecord | null>;
  /** Removes one document, only when it belongs to the owner; `false` when there was none. */
  removeForOwner(ownerId: string, id: string): Promise<boolean>;
}
