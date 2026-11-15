import type { Query } from "@krizaka/db";

/** The metadata of a stored document (the bytes live in object storage, not here). */
export interface DocumentRecord {
  id: string;
  ownerId: string;
  title: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: Date;
}

export type NewDocument = Pick<DocumentRecord, "ownerId" | "title" | "mediaType" | "sizeBytes">;

/** The port: the only door to the document tables. Services depend on this, never on SQL. */
export interface DocumentStore {
  add(document: NewDocument): Promise<DocumentRecord>;
  /** The owner's documents, newest first, at most `limit` (never an unbounded read). */
  listByOwner(ownerId: string, limit?: number): Promise<DocumentRecord[]>;
  /** One document, only when it belongs to the owner (never another owner's). */
  findForOwner(ownerId: string, id: string): Promise<DocumentRecord | null>;
}

// @fixed: the default and the ceiling of one page of documents, a technical bound of the read
export const LIST_LIMIT = { default: 50, max: 200 } as const;

interface Row {
  id: string;
  owner_id: string;
  title: string;
  media_type: string;
  size_bytes: string;
  created_at: Date;
}

const COLUMNS = "id, owner_id, title, media_type, size_bytes, created_at";

const recordOf = (row: Row): DocumentRecord => ({
  id: row.id,
  ownerId: row.owner_id,
  title: row.title,
  mediaType: row.media_type,
  sizeBytes: Number(row.size_bytes),
  createdAt: row.created_at,
});

/** The PostgreSQL adapter of the port, on any `Query` (the pool, or the client of a transaction). */
export function createDocumentStore(query: Query): DocumentStore {
  return {
    async add(document) {
      const [row] = await query<Row>(
        `INSERT INTO document (owner_id, title, media_type, size_bytes) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
        [document.ownerId, document.title, document.mediaType, document.sizeBytes],
      );
      return recordOf(row!);
    },
    async listByOwner(ownerId, limit = LIST_LIMIT.default) {
      const bounded = Math.min(Math.max(1, Math.trunc(limit)), LIST_LIMIT.max);
      const rows = await query<Row>(
        `SELECT ${COLUMNS} FROM document WHERE owner_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [ownerId, bounded],
      );
      return rows.map(recordOf);
    },
    async findForOwner(ownerId, id) {
      const [row] = await query<Row>(`SELECT ${COLUMNS} FROM document WHERE owner_id = $1 AND id = $2`, [ownerId, id]);
      return row ? recordOf(row) : null;
    },
  };
}
