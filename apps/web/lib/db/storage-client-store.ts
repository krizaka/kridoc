import type { Query } from "@krizaka/db";

import type { StorageClient, StorageClientStore } from "@/lib/storage/client-port";

interface Row {
  id: string;
  product: StorageClient["product"];
  tenant_id: string;
  scopes: StorageClient["scopes"];
  created_at: Date;
  revoked_at: Date | null;
}

// The token hash is written, never read back.
const COLUMNS = "id, product, tenant_id, scopes, created_at, revoked_at";

const clientOf = (row: Row): StorageClient => ({
  id: row.id,
  product: row.product,
  tenantId: row.tenant_id,
  scopes: row.scopes,
  createdAt: row.created_at,
  revokedAt: row.revoked_at,
});

/** The PostgreSQL adapter of the clients' port (`storage_client`, infra/migrations/2026-11-18-storage-clients.sql). */
export function createStorageClientStore(query: Query): StorageClientStore {
  const one = async (text: string, values: unknown[]) => {
    const [row] = await query<Row>(text, values);
    return row ? clientOf(row) : null;
  };
  return {
    async add(client) {
      const added = await one(
        `INSERT INTO storage_client (product, tenant_id, token_hash, scopes, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [client.product, client.tenantId, client.tokenHash, client.scopes, client.createdAt],
      );
      return added!;
    },
    findActiveByHash: (tokenHash) =>
      one(`SELECT ${COLUMNS} FROM storage_client WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash]),
    findActive: (id) => one(`SELECT ${COLUMNS} FROM storage_client WHERE id = $1 AND revoked_at IS NULL`, [id]),
    async revoke(id, at) {
      const rows = await query(
        "UPDATE storage_client SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id",
        [id, at],
      );
      return rows.length > 0;
    },
    async list(limit) {
      const rows = await query<Row>(`SELECT ${COLUMNS} FROM storage_client ORDER BY created_at DESC LIMIT $1`, [
        Math.max(1, Math.trunc(limit)),
      ]);
      return rows.map(clientOf);
    },
  };
}
