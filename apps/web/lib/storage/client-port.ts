/** The products that may keep files in Kridoc: each is independent and gets its own tenant per environment (`verikora-prod`). */
export const STORAGE_PRODUCT = { verikora: "verikora", folioviv: "folioviv", sovkora: "sovkora" } as const;
export type StorageProduct = (typeof STORAGE_PRODUCT)[keyof typeof STORAGE_PRODUCT];

/** What a token may do: write, read (get, head, list), delete, and hand out signed links. */
export const STORAGE_SCOPE = { put: "put", get: "get", delete: "delete", sign: "sign" } as const;
export type StorageScope = (typeof STORAGE_SCOPE)[keyof typeof STORAGE_SCOPE];

/** One product's client: its tenant and what its token may do. Never its token, never its hash. */
export interface StorageClient {
  id: string;
  product: StorageProduct;
  tenantId: string;
  scopes: readonly StorageScope[];
  createdAt: Date;
  revokedAt: Date | null;
}

export type NewStorageClient = Pick<StorageClient, "product" | "tenantId" | "scopes" | "createdAt"> & {
  /** The keyed hash of the token (the token itself is never stored). */
  tokenHash: string;
};

/** The port of the clients' table (`storage_client`); the adapter is lib/db/storage-client-store.ts. */
export interface StorageClientStore {
  add(client: NewStorageClient): Promise<StorageClient>;
  /** The client of this token hash, only while it is not revoked. */
  findActiveByHash(tokenHash: string): Promise<StorageClient | null>;
  /** The client of this id, only while it is not revoked (a signed link dies with its client). */
  findActive(id: string): Promise<StorageClient | null>;
  /** Revokes a client at `at`; `false` when there was no such client still active. */
  revoke(id: string, at: Date): Promise<boolean>;
  /** The clients, newest first, at most `limit`. */
  list(limit: number): Promise<StorageClient[]>;
}
