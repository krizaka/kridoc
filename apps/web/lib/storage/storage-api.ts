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
import { sha256Of } from "./object-digest";
import type { LinkClaim, SignedLinks } from "./signed-links";
import { AUDIT_ACTOR, keyHashOf, STORAGE_AUDIT, type StorageAudit, type StorageAuditAction } from "./storage-audit";
import type { StorageClients } from "./storage-clients";
import type { StorageRules, StorageRulesSource } from "./storage-settings";
import { tenantWriteLock } from "./tenant-write-lock";

/** The version of this contract (the OpenAPI document's `info.version`), told by `GET /ping`. */
// @fixed: the contract's own version, bumped with docs/architecture/kridoc-storage-api.v1.openapi.yaml
export const STORAGE_API_VERSION = "1.1.0";
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

/** One page of a list: `after` is the last key of the page before; `limit` is capped by the settings' bound. */
export interface ListPage {
  after?: string;
  limit?: number;
}

export interface ListAnswer {
  objects: ObjectInfo[];
  /** The key to pass as `after` for the next page, or `null` on the last page. */
  next: string | null;
  truncated: boolean;
}

export interface PingAnswer {
  tenant: string;
  scopes: readonly StorageScope[];
  /** When the client's key stops working; `null` while keys do not expire (they are revoked). */
  keyExpiresAt: string | null;
  api: string;
}

export interface UsageAnswer {
  bytes: number;
  objects: number;
  quota: { bytes: number; objects: number };
}

export interface PutOptions {
  sha256?: string;
  createOnly?: boolean;
}

/** What a deletion leaves: the proof of what was removed (also written to the audit ledger, by hash of the key). */
export type DeletionRecord =
  { key: string; absent: true } | { key: string; deletedAt: string; sha256: string; size: number; recordId: string };

export interface StorageApi {
  /** The client of a token, counted by the limiter. @throws StorageApiError `STORAGE_UNAUTHENTICATED`, RateLimited */
  authenticate(token: string | undefined): Promise<StorageClient>;
  /**
   * `options.sha256`: the digest the client declares; the bytes received are hashed and a mismatch writes nothing (`STORAGE_DIGEST_MISMATCH`).
   * `options.createOnly`: the key is never replaced: the same digest is a replay (`replayed`), another is `STORAGE_OBJECT_EXISTS`; the
   * check and the write are one turn of the tenant's write lock, so two concurrent writes cannot both win.
   * A write past the tenant's quota (bytes or objects) is refused before anything is stored: `STORAGE_QUOTA_EXCEEDED`.
   */
  put(
    client: StorageClient,
    key: string,
    bytes: Uint8Array,
    declaredType: string,
    options?: PutOptions,
  ): Promise<ObjectInfo & { contentType: string; sha256: string; replayed: boolean }>;
  get(client: StorageClient, key: string): Promise<StoredObject & { sha256: string }>;
  head(client: StorageClient, key: string): Promise<ObjectInfo & { sha256: string }>;
  /** Idempotent: deleting a missing object is not an error; it answers the deletion record, or `absent`. */
  remove(client: StorageClient, key: string): Promise<DeletionRecord>;
  /** The tenant's objects under `prefix`, in key order, one page at a time. @throws StorageApiError `STORAGE_INVALID_INPUT` (a bad limit) */
  list(client: StorageClient, prefix: string, page?: ListPage): Promise<ListAnswer>;
  /** Who the token is: any authenticated client may ask. */
  ping(client: StorageClient): PingAnswer;
  /** What the tenant keeps and what it may keep. */
  usage(client: StorageClient): Promise<UsageAnswer>;
  sign(client: StorageClient, key: string, ttlSeconds?: number): Promise<{ query: LinkQuery; expiresAt: Date }>;
  /** The object a signed link opens, while it lives and its client is not revoked. @throws StorageApiError `STORAGE_LINK_REFUSED` */
  readLink(query: LinkQuery): Promise<StoredObject & { sha256: string }>;
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

/** An object, or `null` when it is missing or can never open again (its tenant's key was shredded). */
async function maybe(store: ObjectStore, key: string): Promise<StoredObject | null> {
  try {
    return await store.get(key);
  } catch (error) {
    if (error instanceof StorageError && error.code === STORAGE_CODE.shredded) return null;
    throw error;
  }
}

/** An object, or « not found ». */
async function found(store: ObjectStore, key: string): Promise<StoredObject> {
  const object = await maybe(store, key);
  if (!object) throw refused(STORAGE_API_ERROR.notFound);
  return object;
}

/** Whether a create-only write is a replay: the key holds these very bytes. @throws StorageApiError `STORAGE_OBJECT_EXISTS` when it holds others */
async function createdAlready(store: ObjectStore, key: string, sha256: string): Promise<boolean> {
  const existing = await maybe(store, key);
  if (!existing) return false;
  if (sha256Of(existing.bytes) !== sha256) throw refused(STORAGE_API_ERROR.objectExists);
  return true;
}

const byKey = (a: ObjectInfo, b: ObjectInfo) => Number(a.key > b.key) - Number(a.key < b.key);

/** The page size asked, within the settings' bound. @throws StorageApiError `STORAGE_INVALID_INPUT` */
function pageSize(limit: number | undefined, max: number): number {
  if (limit === undefined) return max;
  if (!Number.isInteger(limit) || limit < 1) throw refused(STORAGE_API_ERROR.invalidInput);
  return Math.min(limit, max);
}

/** What a tenant keeps now: its objects and their bytes. */
async function keptBy(store: ObjectStore): Promise<{ objects: ObjectInfo[]; bytes: number }> {
  const objects = await store.list("");
  return { objects, bytes: objects.reduce((sum, o) => sum + o.size, 0) };
}

/** Refuses a write that would take the tenant past its quota; a replaced key counts only for what it adds. @throws StorageApiError `STORAGE_QUOTA_EXCEEDED` */
async function assertRoom(store: ObjectStore, key: string, size: number, rules: StorageRules): Promise<void> {
  const kept = await keptBy(store);
  const replaced = kept.objects.find((o) => o.key === key);
  const bytes = kept.bytes - (replaced?.size ?? 0) + size;
  const objects = kept.objects.length + (replaced ? 0 : 1);
  if (bytes > rules.quotaBytes || objects > rules.quotaObjects) throw refused(STORAGE_API_ERROR.quotaExceeded);
}

/** The record of a deletion; its id is derived from what it says, so the same deletion is the same record. */
function deletionRecordOf(client: StorageClient, key: string, bytes: Uint8Array, at: Date) {
  const sha256 = sha256Of(bytes);
  const deletedAt = at.toISOString();
  const recordId = `del_${sha256Of(new TextEncoder().encode([client.tenantId, key, deletedAt, sha256].join("\n"))).slice(0, 24)}`;
  return { key, deletedAt, sha256, size: bytes.byteLength, recordId };
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
      return { ...object, sha256: sha256Of(object.bytes) };
    },
  };
}

/** The write: type and size judged, digest checked, then create-only and the quota in one turn of the tenant's write lock. */
function putOf(deps: StorageApiDeps, acts: ReturnType<typeof actsOf>): StorageApi["put"] {
  const { note, storeOf } = acts;
  const writes = tenantWriteLock();
  return async (client, key, bytes, declaredType, options = {}) => {
    need(client, STORAGE_SCOPE.put);
    const checked = checkedKey(key);
    const quota = await deps.rules();
    const contentType = acceptedType(bytes, declaredType, quota);
    const sha256 = sha256Of(bytes);
    if (options.sha256 !== undefined && options.sha256 !== sha256) throw refused(STORAGE_API_ERROR.digestMismatch);
    const info = { key: checked, size: bytes.byteLength, contentType, sha256 };
    const store = storeOf(client);
    return writes.run(client.tenantId, async () => {
      if (options.createOnly && (await createdAlready(store, checked, sha256))) {
        await note(STORAGE_AUDIT.uploaded, client, checked, { size: bytes.byteLength, replayed: "yes" });
        return { ...info, replayed: true };
      }
      await assertRoom(store, checked, bytes.byteLength, quota);
      await store.put(checked, bytes, { contentType });
      await note(STORAGE_AUDIT.uploaded, client, checked, { size: bytes.byteLength });
      return { ...info, replayed: false };
    });
  };
}

/** What a client reads about its tenant as a whole: a page of its objects, who it is, what it keeps. */
function listingsOf(
  deps: StorageApiDeps,
  acts: ReturnType<typeof actsOf>,
): Pick<StorageApi, "list" | "ping" | "usage"> {
  const { note, storeOf } = acts;
  return {
    async list(client, prefix, page = {}) {
      need(client, STORAGE_SCOPE.get);
      const size = pageSize(page.limit, deps.limits.listMax);
      const after = page.after === undefined ? undefined : checkedKey(page.after);
      const all = (await storeOf(client).list(checkedPrefix(prefix))).sort(byKey);
      const rest = after === undefined ? all : all.filter((o) => o.key > after);
      const objects = rest.slice(0, size);
      const more = rest.length > size;
      await note(STORAGE_AUDIT.listed, client, undefined, { count: objects.length });
      return { objects, next: more ? objects[objects.length - 1]!.key : null, truncated: more };
    },
    ping: (client) => ({
      tenant: client.tenantId,
      scopes: client.scopes,
      keyExpiresAt: null,
      api: STORAGE_API_VERSION,
    }),
    async usage(client) {
      need(client, STORAGE_SCOPE.get);
      const [kept, rules] = await Promise.all([keptBy(storeOf(client)), deps.rules()]);
      return {
        bytes: kept.bytes,
        objects: kept.objects.length,
        quota: { bytes: rules.quotaBytes, objects: rules.quotaObjects },
      };
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
    put: putOf(deps, acts),
    async get(client, key) {
      need(client, STORAGE_SCOPE.get);
      const object = await found(storeOf(client), checkedKey(key));
      await note(STORAGE_AUDIT.read, client, key, { size: object.bytes.byteLength });
      return { ...object, sha256: sha256Of(object.bytes) };
    },
    async head(client, key) {
      need(client, STORAGE_SCOPE.get);
      // The digest is of the plaintext, which only the tenant's key opens: it is read, not kept beside the sealed bytes.
      const object = await found(storeOf(client), checkedKey(key));
      await note(STORAGE_AUDIT.head, client, key);
      return { key: checkedKey(key), size: object.bytes.byteLength, sha256: sha256Of(object.bytes) };
    },
    async remove(client, key) {
      need(client, STORAGE_SCOPE.delete);
      const checked = checkedKey(key);
      const store = storeOf(client);
      const existing = await maybe(store, checked);
      await store.delete(checked);
      if (!existing) {
        await note(STORAGE_AUDIT.deleted, client, checked, { absent: "yes" });
        return { key: checked, absent: true };
      }
      const record = deletionRecordOf(client, checked, existing.bytes, deps.clock.now());
      await note(STORAGE_AUDIT.deleted, client, checked, {
        recordId: record.recordId,
        sha256: record.sha256,
        size: record.size,
      });
      return record;
    },
    ...listingsOf(deps, acts),
    ...linksOf(deps, acts),
  };
}
