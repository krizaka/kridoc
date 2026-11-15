import type { Clock } from "@krizaka/db";
import { z } from "zod";

import { STORAGE_API_ERROR, StorageApiError } from "./api-errors";
import {
  STORAGE_PRODUCT,
  STORAGE_SCOPE,
  type StorageClient,
  type StorageClientStore,
  type StorageProduct,
  type StorageScope,
} from "./client-port";
import type { ClientTokens } from "./client-tokens";
import { AUDIT_ACTOR, STORAGE_AUDIT, type StorageAudit } from "./storage-audit";

/** What an administrator asks for: a product, its tenant for one environment, and what the token may do. */
export interface ClientRequest {
  product: StorageProduct;
  tenantId: string;
  scopes: readonly StorageScope[];
}

export interface StorageClients {
  /** A new client: the token is in the answer once and never again (only its keyed hash is kept). */
  issue(request: ClientRequest): Promise<{ client: StorageClient; token: string }>;
  /** `false` when there was no such client still active. */
  revoke(id: string): Promise<boolean>;
  /** @throws StorageApiError `STORAGE_UNAUTHENTICATED` for a missing, malformed, unknown or revoked token, all alike */
  authenticate(token: string | undefined): Promise<StorageClient>;
  /** The client of a signed link, while it is not revoked. */
  activeById(id: string): Promise<StorageClient | null>;
  list(limit: number): Promise<StorageClient[]>;
}

export interface StorageClientsDeps {
  store: StorageClientStore;
  tokens: ClientTokens;
  clock: Clock;
  audit: StorageAudit;
}

// @fixed: the tenant id of @krizaka/storage (`assertTenantId`), here also `<product>-<environment>`
const TENANT_ID = /^[a-z][a-z0-9]{1,31}-[A-Za-z0-9_-]{1,32}$/;
// @fixed: the prefix of Kridoc's own accounts' tenants (lib/storage/document-vault.ts), never a product's
const ACCOUNT_TENANT_PREFIX = "account-";

const requestSchema = z.object({
  product: z.enum(Object.values(STORAGE_PRODUCT)),
  tenantId: z.string().regex(TENANT_ID),
  scopes: z.array(z.enum(Object.values(STORAGE_SCOPE))).min(1),
});

/** A request the rules accept: a known product, a tenant of its own (never an account's), at least one known scope. */
function acceptedRequest(request: ClientRequest): ClientRequest {
  const parsed = requestSchema.safeParse(request);
  const ok =
    parsed.success &&
    parsed.data.tenantId.startsWith(`${parsed.data.product}-`) &&
    !parsed.data.tenantId.startsWith(ACCOUNT_TENANT_PREFIX);
  if (!ok) throw new StorageApiError(STORAGE_API_ERROR.invalidInput);
  return { ...parsed.data, scopes: [...new Set(parsed.data.scopes)] };
}

const isId = (id: string): boolean => z.uuid().safeParse(id).success;

/** The products' clients: issued and revoked by an administrator (the CLI), authenticated at every API call. */
export function createStorageClients(deps: StorageClientsDeps): StorageClients {
  const audited = (action: typeof STORAGE_AUDIT.issued | typeof STORAGE_AUDIT.revoked, client: StorageClient) =>
    deps.audit({ action, actor: { kind: AUDIT_ACTOR.client, id: client.id }, tenantId: client.tenantId });
  return {
    async issue(request) {
      const accepted = acceptedRequest(request);
      const token = deps.tokens.newToken();
      const client = await deps.store.add({
        ...accepted,
        tokenHash: deps.tokens.hashOf(token),
        createdAt: deps.clock.now(),
      });
      await audited(STORAGE_AUDIT.issued, client);
      return { client, token };
    },
    async revoke(id) {
      const client = isId(id) ? await deps.store.findActive(id) : null;
      if (!client || !(await deps.store.revoke(id, deps.clock.now()))) return false;
      await audited(STORAGE_AUDIT.revoked, client);
      return true;
    },
    async authenticate(token) {
      const client = deps.tokens.isToken(token) ? await deps.store.findActiveByHash(deps.tokens.hashOf(token)) : null;
      if (!client) throw new StorageApiError(STORAGE_API_ERROR.unauthenticated);
      return client;
    },
    activeById: async (id) => (isId(id) ? deps.store.findActive(id) : null),
    list: (limit) => deps.store.list(limit),
  };
}
