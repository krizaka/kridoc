/**
 * The refusals of the storage API for products (`/api/storage/v1`): a stable code each, its HTTP status said once here, its words in
 * messages/<locale>.json (`storageApi.errors.<code>`).
 */
export const STORAGE_API_ERROR = {
  off: "STORAGE_API_OFF",
  unauthenticated: "STORAGE_UNAUTHENTICATED",
  scopeRefused: "STORAGE_SCOPE_REFUSED",
  notFound: "STORAGE_OBJECT_NOT_FOUND",
  keyRefused: "STORAGE_KEY_REFUSED",
  tooBig: "STORAGE_OBJECT_TOO_BIG",
  typeRefused: "STORAGE_TYPE_REFUSED",
  linkRefused: "STORAGE_LINK_REFUSED",
  digestMismatch: "STORAGE_DIGEST_MISMATCH",
  objectExists: "STORAGE_OBJECT_EXISTS",
  invalidInput: "STORAGE_INVALID_INPUT",
  rateLimited: "RATE_LIMITED",
  internal: "INTERNAL",
} as const;
export type StorageApiErrorCode = (typeof STORAGE_API_ERROR)[keyof typeof STORAGE_API_ERROR];

export const STORAGE_API_STATUS: Readonly<Record<StorageApiErrorCode, number>> = {
  STORAGE_API_OFF: 404,
  STORAGE_UNAUTHENTICATED: 401,
  STORAGE_SCOPE_REFUSED: 403,
  STORAGE_OBJECT_NOT_FOUND: 404,
  STORAGE_KEY_REFUSED: 400,
  STORAGE_OBJECT_TOO_BIG: 413,
  STORAGE_TYPE_REFUSED: 415,
  STORAGE_LINK_REFUSED: 403,
  STORAGE_DIGEST_MISMATCH: 400,
  STORAGE_OBJECT_EXISTS: 412,
  STORAGE_INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** A typed refusal. The message is the code: never a token, a key or a byte of an object. */
export class StorageApiError extends Error {
  constructor(readonly code: StorageApiErrorCode) {
    super(code);
    this.name = "StorageApiError";
  }
}
