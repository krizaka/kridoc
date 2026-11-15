import { assertKey, type FetchLike, type ObjectStore, STORAGE_CODE, StorageError } from "@krizaka/storage";

import { STORAGE_API_ERROR } from "./api-errors";

export interface KridocApiStoreOptions {
  /** Kridoc's origin (`https://www.kridoc.com`). */
  endpoint: string;
  /** The product's token (`kst1.…`), from its secret store: sent as `Authorization: Bearer`, never logged. */
  token: string;
  fetch: FetchLike;
}

// @fixed: the versioned base of the storage API (docs/architecture/kridoc-storage-api.v1.openapi.yaml)
const API_BASE = "/api/storage/v1";

const encodedKey = (key: string): string => assertKey(key).split("/").map(encodeURIComponent).join("/");

type Answer = Awaited<ReturnType<FetchLike>>;

/** A refusal of the API as the port's error: the API's code is named, never the body's words or the token. */
const failure = async (answer: Answer, what: string): Promise<never> => {
  const code = await answer
    .text()
    .then((text) => String((JSON.parse(text) as { code?: unknown }).code ?? ""))
    .catch(() => "");
  const named = code ? ` ${code}` : "";
  throw new StorageError(STORAGE_CODE.provider, `kridoc ${what}: HTTP ${answer.status}${named}`);
};

/** A 404 that says the object is missing (the API being off is a 404 too, and is an error, not an absence). */
const isMissing = async (answer: Answer): Promise<boolean> => {
  if (answer.status !== 404) return false;
  const text = await answer.text().catch(() => "");
  return text === "" || text.includes(STORAGE_API_ERROR.notFound);
};

/**
 * The reference client of Kridoc's storage API (krizaka-internal#3756): an `ObjectStore` over `/api/storage/v1`, passing
 * `objectStoreContract` of @krizaka/storage/testkit against Kridoc's own routes. Verikora's `kridoc` provider (krizaka-internal#3757)
 * is this client; it belongs in @krizaka/storage next to `remoteStore`. Keys are checked here first (`assertKey`): a `..` is never sent.
 */
export function kridocApiStore(options: KridocApiStoreOptions): ObjectStore {
  const auth = { Authorization: `Bearer ${options.token}` };
  const url = (path: string) => new URL(`${API_BASE}${path}`, options.endpoint).toString();
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: Uint8Array) =>
    options.fetch(url(path), { method, headers: { ...auth, ...headers }, ...(body ? { body } : {}) });
  return {
    async put(key, bytes, meta) {
      const answer = await call("PUT", `/objects/${encodedKey(key)}`, { "Content-Type": meta.contentType }, bytes);
      if (!answer.ok) await failure(answer, "put");
    },
    async get(key) {
      const answer = await call("GET", `/objects/${encodedKey(key)}`);
      if (await isMissing(answer)) return null;
      if (!answer.ok) return failure(answer, "get");
      const contentType = answer.headers.get("content-type") ?? "application/octet-stream";
      return { bytes: new Uint8Array(await answer.arrayBuffer()), contentType };
    },
    async head(key) {
      const answer = await call("HEAD", `/objects/${encodedKey(key)}`);
      if (answer.status === 404) return null;
      if (!answer.ok) return failure(answer, "head");
      return { key, size: Number(answer.headers.get("content-length") ?? 0) };
    },
    async delete(key) {
      const answer = await call("DELETE", `/objects/${encodedKey(key)}`);
      if (!answer.ok) await failure(answer, "delete");
    },
    async list(prefix) {
      const answer = await call("GET", `/objects?prefix=${encodeURIComponent(prefix)}`);
      if (!answer.ok) return failure(answer, "list");
      return (JSON.parse(await answer.text()) as { objects: { key: string; size: number }[] }).objects;
    },
    async signedUrl(key, ttlSeconds) {
      const body = new TextEncoder().encode(JSON.stringify({ ttlSeconds }));
      const answer = await call("POST", `/links/${encodedKey(key)}`, { "Content-Type": "application/json" }, body);
      if (!answer.ok) return failure(answer, "sign");
      return (JSON.parse(await answer.text()) as { url: string }).url;
    },
    publicUrl: () => null,
  };
}
