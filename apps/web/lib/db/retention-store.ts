import type { Query } from "@krizaka/db";

import type { RetentionStore, SweepCursor } from "@/lib/storage/retention-port";

interface DocumentRow {
  id: string;
  owner_id: string;
}

/** The PostgreSQL adapter of the sweep's reads: every one has a LIMIT, every one is on an index (`document_owner_created_idx`, the primary keys). */
export function createRetentionStore(query: Query): RetentionStore {
  return {
    async expired(cutoff, limit) {
      const rows = await query<DocumentRow>(
        `SELECT id, owner_id FROM document WHERE created_at < $1 ORDER BY created_at, id LIMIT $2`,
        [cutoff, limit],
      );
      return rows.map((row) => ({ id: row.id, ownerId: row.owner_id }));
    },
    async remove(document) {
      const rows = await query(`DELETE FROM document WHERE owner_id = $1 AND id = $2 RETURNING id`, [
        document.ownerId,
        document.id,
      ]);
      return rows.length > 0;
    },
    async ownersAfter(cursor, limit) {
      const rows = await query<{ id: string }>(
        `SELECT id FROM account WHERE $1::uuid IS NULL OR id > $1::uuid ORDER BY id LIMIT $2`,
        [cursor, limit],
      );
      return rows.map((row) => row.id);
    },
    async existing(ownerId, ids) {
      const rows = await query<{ id: string }>(`SELECT id FROM document WHERE owner_id = $1 AND id = ANY($2::uuid[])`, [
        ownerId,
        [...ids],
      ]);
      return new Set(rows.map((row) => row.id));
    },
  };
}

/** The sweep's place in `storage_sweep_cursor` (one row). */
export function createSweepCursor(query: Query): SweepCursor {
  return {
    async read() {
      const [row] = await query<{ last_owner: string | null }>(`SELECT last_owner FROM storage_sweep_cursor`);
      return row?.last_owner ?? null;
    },
    async write(owner) {
      await query(
        `INSERT INTO storage_sweep_cursor (only_row, last_owner, swept_at) VALUES (true, $1, now())
         ON CONFLICT (only_row) DO UPDATE SET last_owner = EXCLUDED.last_owner, swept_at = EXCLUDED.swept_at`,
        [owner],
      );
    },
  };
}
