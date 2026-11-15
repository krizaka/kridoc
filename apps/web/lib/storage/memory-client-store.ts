import { randomUUID } from "node:crypto";

import type { StorageClient, StorageClientStore } from "./client-port";

type Row = StorageClient & { tokenHash: string };

const view = (row: Row): StorageClient => ({
  id: row.id,
  product: row.product,
  tenantId: row.tenantId,
  scopes: row.scopes,
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
});
const isActive = (row: Row | undefined): row is Row => row !== undefined && row.revokedAt === null;

/** The clients' port in memory: for the services' tests; production uses lib/db/storage-client-store.ts. */
export function memoryStorageClientStore(): StorageClientStore {
  const rows = new Map<string, Row>();
  return {
    async add(client) {
      const row: Row = { ...client, id: randomUUID(), revokedAt: null };
      rows.set(row.id, row);
      return view(row);
    },
    async findActiveByHash(tokenHash) {
      const row = [...rows.values()].find((r) => r.tokenHash === tokenHash);
      return isActive(row) ? view(row) : null;
    },
    async findActive(id) {
      const row = rows.get(id);
      return isActive(row) ? view(row) : null;
    },
    async revoke(id, at) {
      const row = rows.get(id);
      if (!isActive(row)) return false;
      row.revokedAt = at;
      return true;
    },
    async list(limit) {
      return [...rows.values()].reverse().slice(0, limit).map(view);
    },
  };
}
