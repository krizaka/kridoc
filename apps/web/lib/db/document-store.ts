import type { Query } from "@krizaka/db";

import type { DocumentRecord, DocumentStore } from "@/lib/storage/document-port";

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
        `INSERT INTO document (id, owner_id, title, media_type, size_bytes) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [document.id ?? null, document.ownerId, document.title, document.mediaType, document.sizeBytes],
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
    async removeForOwner(ownerId, id) {
      const rows = await query(`DELETE FROM document WHERE owner_id = $1 AND id = $2 RETURNING id`, [ownerId, id]);
      return rows.length > 0;
    },
  };
}
