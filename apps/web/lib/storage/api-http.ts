import { RateLimited } from "@krizaka/rate-limit";
import { STORAGE_CODE, StorageError, type StoredObject } from "@krizaka/storage";

import { localeOfRequest, problemOf } from "@/lib/auth/http";
import { getDictionary } from "@/lib/i18n";

import { STORAGE_API_ERROR, STORAGE_API_STATUS, StorageApiError, type StorageApiErrorCode } from "./api-errors";

/** The refusals of @krizaka/storage the API can meet, as its own codes. */
const FROM_STORAGE: Partial<Record<string, StorageApiErrorCode>> = {
  [STORAGE_CODE.badKey]: STORAGE_API_ERROR.keyRefused,
  [STORAGE_CODE.tooBig]: STORAGE_API_ERROR.tooBig,
  [STORAGE_CODE.badType]: STORAGE_API_ERROR.typeRefused,
  [STORAGE_CODE.typeMismatch]: STORAGE_API_ERROR.typeRefused,
  [STORAGE_CODE.shredded]: STORAGE_API_ERROR.notFound,
};

export function storageApiCodeOf(error: unknown): StorageApiErrorCode {
  if (error instanceof StorageApiError) return error.code;
  if (error instanceof RateLimited) return STORAGE_API_ERROR.rateLimited;
  if (error instanceof StorageError) return FROM_STORAGE[error.code] ?? STORAGE_API_ERROR.internal;
  return STORAGE_API_ERROR.internal;
}

/** The headers a refusal carries: the scheme to use when unauthenticated, when to come back when limited. */
function refusalHeaders(error: unknown, code: StorageApiErrorCode): Record<string, string> {
  if (error instanceof RateLimited) return error.headers;
  return code === STORAGE_API_ERROR.unauthenticated ? { "WWW-Authenticate": 'Bearer realm="kridoc-storage"' } : {};
}

/** The one place a storage API refusal becomes an HTTP answer: status from the code, words from the catalogue. */
export function storageApiRefusal(error: unknown, request: Request): Response {
  const code = storageApiCodeOf(error);
  // Only the kind of failure is logged: never a message (a provider's can carry a key), a token or a byte.
  if (code === STORAGE_API_ERROR.internal)
    console.error(`storage-api: unexpected failure (${error instanceof Error ? error.name : typeof error})`);
  const detail = getDictionary(localeOfRequest(request)).storageApi.errors[code];
  return problemOf(code, STORAGE_API_STATUS[code], detail, refusalHeaders(error, code));
}

/** The bearer token of a request (`Authorization: Bearer kst1.…`), not yet checked. */
export function bearerOf(headers: Headers): string | undefined {
  const [scheme, token, ...rest] = (headers.get("authorization") ?? "").trim().split(/\s+/);
  return scheme?.toLowerCase() === "bearer" && token && rest.length === 0 ? token : undefined;
}

/** The object key of a catch-all route (`[...key]`): the segments as Next decoded them, joined; `assertKey` judges it after. */
export const keyOfSegments = (segments: readonly string[]): string => segments.join("/");

/**
 * A request's body, at most `maxBytes`: a declared length over it is refused before anything is read, and a stream that runs past it
 * is cut. @throws StorageApiError `STORAGE_OBJECT_TOO_BIG`
 */
export async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const tooBig = () => new StorageApiError(STORAGE_API_ERROR.tooBig);
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw tooBig();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(read.value);
  }
  return Buffer.concat(chunks);
}

const OBJECT_HEADERS = {
  "Content-Disposition": "attachment",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
} as const;

/** An object's bytes as the answer: its stored type, never rendered inline, never cached, never sniffed again by a browser. */
export const objectResponse = (object: StoredObject): Response =>
  new Response(object.bytes.slice(), {
    headers: {
      ...OBJECT_HEADERS,
      "Content-Type": object.contentType,
      "Content-Length": String(object.bytes.byteLength),
    },
  });

/** An object's size without its bytes (HEAD). */
export const headResponse = (size: number): Response =>
  new Response(null, { headers: { ...OBJECT_HEADERS, "Content-Length": String(size) } });
