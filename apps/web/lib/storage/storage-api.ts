import type { Clock } from "@krizaka/db";
import type { Limiter } from "@krizaka/rate-limit";
import {
  assertKey,
  type ObjectInfo,
  type ObjectStore,
  sniffType,
  STORAGE_CODE,
  StorageError,
  type StoredObject,
} from "@krizaka/storage";

import { STORAGE_API_ERROR, StorageApiError } from "./api-errors";
import { STORAGE_SCOPE, type StorageClient, type StorageScope } from "./client-port";
import type { LinkClaim, SignedLinks } from "./signed-links";
import { AUDIT_ACTOR, keyHashOf, STORAGE_AUDIT, type StorageAudit, type StorageAuditAction } from "./storage-audit";
import type { StorageClients } from "./storage-clients";
import type { StorageRules, StorageRulesSource } from "./storage-settings";

/** The limiter's action of every API call, counted per client (`perSubject`, the client's id). */
export const STORAGE_API_ACTION = "storage.api";

/** The technical bound of the API (SETTINGS.storageApi); the rules an administrator sets come through `StorageApiDeps.rules`. */
export interface StorageApiLimits {
  /** The most objects one list answers. */
  listMax: number;
}

export interface StorageApiDeps {
  clients: StorageClients;
  /** The sealed store of one tenant (`tenantStore` of @krizaka/storage over the installation's store). */
  objectsOf(tenantId: string): ObjectStore;
  limiter: Pick<Limiter, "enforce">;
  links: SignedLinks;
  clock: Clock;
  audit: StorageAudit;
  limits: StorageApiLimits;
  /** The administrator's rules (size, types, link lifetime), read on every upload and every link: a change applies at once. */
  rules: StorageRulesSource;
}

/** A signed link as query parameters: `client`, `key`, `expires` (seconds since 1970), `signature`. */
export interface LinkQuery {
  client: string;
  key: string;
  expires: string;
  signature: string;
}

export interface StorageApi {
  /** The client of a token, counted by the limiter. @throws StorageApiError `STORAGE_UNAUTHENTICATED`, RateLimited */
  authenticate(token: string | undefined): Promise<StorageClient>;
  put(
    client: StorageClient,
    key: string,
    bytes: Uint8Array,
    declaredType: string,
  ): Promise<ObjectInfo & { contentType: string }>;
  get(client: StorageClient, key: string): Promise<StoredObject>;
  head(client: StorageClient, key: string): Promise<ObjectInfo>;
  /** Idempotent: deleting a missing object is not an error. */
  remove(client: StorageClient, key: string): Promise<void>;
  list(client: StorageClient, prefix: string): Promise<{ objects: ObjectInfo[]; truncated: boolean }>;
  sign(client: StorageClient, key: string, ttlSeconds?: number): Promise<{ query: LinkQuery; expiresAt: Date }>;
  /** The object a signed link opens, while it lives and its client is not revoked. @throws StorageApiError `STORAGE_LINK_REFUSED` */
  readLink(query: LinkQuery): Promise<StoredObject>;
}

// @fixed: a key's length bound, far above any product's layout and below every provider's limit
const KEY_MAX = 512;
const EXPIRES = /^\d{1,12}$/;

const refused = (code: (typeof STORAGE_API_ERROR)[keyof typeof STORAGE_API_ERROR]) => new StorageApiError(code);

/** A key of the client's own tenant: `a/b/name.ext` (`assertKey`), joined under the tenant's prefix by `tenantStore`. */
function checkedKey(key: string): string {
  if (key.length > KEY_MAX) throw refused(STORAGE_API_ERROR.keyRefused);
  try {
    return assertKey(key);
  } catch {
    throw refused(STORAGE_API_ERROR.keyRefused);
  }
}

/** A list prefix: empty, or the start of a key that `assertKey` would accept (`a/`, `a/o`). */
function checkedPrefix(prefix: string): string {
  if (prefix === "") return prefix;
  checkedKey(prefix.endsWith("/") ? `${prefix}x` : prefix);
  return prefix;
}

/**
 * The declared type when the rules accept it and the bytes do not contradict it: bytes of a known type (magic number) must be that
 * type, so they cannot hide under `application/octet-stream` (the type of a product's own ciphertext, which sniffs as nothing).
 */
function acceptedType(bytes: Uint8Array, declared: string, rules: StorageRules): string {
  if (bytes.byteLength === 0 || bytes.byteLength > rules.maxBytes) throw refused(STORAGE_API_ERROR.tooBig);
  const type = declared.split(";")[0]!.trim().toLowerCase();
  if (!rules.types.includes(type)) throw refused(STORAGE_API_ERROR.typeRefused);
  const sniffed = sniffType(bytes);
  if (sniffed !== null && sniffed !== type) throw refused(STORAGE_API_ERROR.typeRefused);
  return type;
}

function need(client: StorageClient, scope: StorageScope): void {
  if (!client.scopes.includes(scope)) throw refused(STORAGE_API_ERROR.scopeRefused);
}

/** An object, or « not found » when it is missing or can never open again (its tenant's key was shredded). */
async function found(store: ObjectStore, key: string): Promise<StoredObject> {
  try {
    const object = await store.get(key);
    if (object) return object;
  } catch (error) {
    if (!(error instanceof StorageError && error.code === STORAGE_CODE.shredded)) throw error;
  }
  throw refused(STORAGE_API_ERROR.notFound);
}

/** The claim of a link whose signature holds and whose time has not passed. */
function validClaim(deps: StorageApiDeps, query: LinkQuery): LinkClaim {
  if (!EXPIRES.test(query.expires)) throw refused(STORAGE_API_ERROR.linkRefused);
  const claim = { clientId: query.client, key: query.key, expiresAt: Number(query.expires) };
  const live = claim.expiresAt * 1000 >= deps.clock.now().getTime();
  if (!deps.links.verify(claim, query.signature) || !live) throw refused(STORAGE_API_ERROR.linkRefused);
  return claim;
}

/** What every act needs: its audit line, the client's own store, the limiter's count. */
function actsOf(deps: StorageApiDeps) {
  return {
    note: (action: StorageAuditAction, client: StorageClient, key?: string, detail?: Record<string, number | string>) =>
      deps.audit({
        action,
        actor: { kind: AUDIT_ACTOR.client, id: client.id },
        tenantId: client.tenantId,
        ...(key === undefined ? {} : { keyHash: keyHashOf(key) }),
        ...(detail ? { detail } : {}),
      }),
    storeOf: (client: StorageClient) => deps.objectsOf(client.tenantId),
    async limited(client: StorageClient) {
      await deps.limiter.enforce(STORAGE_API_ACTION, { subject: client.id });
      return client;
    },
  };
}

/** The signed links: a claim signed for one object of the client's tenant, and its reading while it lives. */
function linksOf(deps: StorageApiDeps, acts: ReturnType<typeof actsOf>): Pick<StorageApi, "sign" | "readLink"> {
  return {
    async sign(client, key, ttlSeconds) {
      need(client, STORAGE_SCOPE.sign);
      const longest = (await deps.rules()).signedUrlSeconds;
      const ttl = Math.max(1, Math.min(Math.trunc(ttlSeconds ?? longest), longest));
      const expiresAt = Math.floor(deps.clock.now().getTime() / 1000) + ttl;
      const claim = { clientId: client.id, key: checkedKey(key), expiresAt };
      await acts.note(STORAGE_AUDIT.signed, client, key, { seconds: ttl });
      const signature = deps.links.signatureOf(claim);
      return {
        query: { client: claim.clientId, key: claim.key, expires: String(expiresAt), signature },
        expiresAt: new Date(expiresAt * 1000),
      };
    },
    async readLink(query) {
      const claim = validClaim(deps, query);
      const client = await deps.clients.activeById(claim.clientId);
      if (!client?.scopes.includes(STORAGE_SCOPE.sign)) throw refused(STORAGE_API_ERROR.linkRefused);
      await acts.limited(client);
      const object = await found(acts.storeOf(client), checkedKey(claim.key));
      await acts.note(STORAGE_AUDIT.read, client, claim.key, { via: "link" });
      return object;
    },
  };
}

/**
 * The storage API of Krizaka's other products: each client reaches only its own tenant, the one its token names (never a value of the
 * request), every object sealed under that tenant's key. Ports in, typed `StorageApiError` out, one audit line per act.
 */
export function createStorageApi(deps: StorageApiDeps): StorageApi {
  const acts = actsOf(deps);
  const { note, storeOf, limited } = acts;
  return {
    authenticate: async (token) => limited(await deps.clients.authenticate(token)),
    async put(client, key, bytes, declaredType) {
      need(client, STORAGE_SCOPE.put);
      const checked = checkedKey(key);
      const contentType = acceptedType(bytes, declaredType, await deps.rules());
      await storeOf(client).put(checked, bytes, { contentType });
      await note(STORAGE_AUDIT.uploaded, client, checked, { size: bytes.byteLength });
      return { key: checked, size: bytes.byteLength, contentType };
    },
    async get(client, key) {
      need(client, STORAGE_SCOPE.get);
      const object = await found(storeOf(client), checkedKey(key));
      await note(STORAGE_AUDIT.read, client, key, { size: object.bytes.byteLength });
      return object;
    },
    async head(client, key) {
      need(client, STORAGE_SCOPE.get);
      const info = await storeOf(client).head(checkedKey(key));
      if (!info) throw refused(STORAGE_API_ERROR.notFound);
      await note(STORAGE_AUDIT.head, client, key);
      return info;
    },
    async remove(client, key) {
      need(client, STORAGE_SCOPE.delete);
      await storeOf(client).delete(checkedKey(key));
      await note(STORAGE_AUDIT.deleted, client, key);
    },
    async list(client, prefix) {
      need(client, STORAGE_SCOPE.get);
      const all = await storeOf(client).list(checkedPrefix(prefix));
      await note(STORAGE_AUDIT.listed, client, undefined, { count: all.length });
      return { objects: all.slice(0, deps.limits.listMax), truncated: all.length > deps.limits.listMax };
    },
    ...linksOf(deps, acts),
  };
}
