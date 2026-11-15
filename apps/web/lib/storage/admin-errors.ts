/** The refusals of the storage admin: a stable code each, its HTTP status said once here, its words in messages/<locale>.json (`storageAdmin.errors.<code>`). */
export const STORAGE_ADMIN_ERROR = {
  off: "ADMIN_OFF",
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  invalid: "INVALID_SETTING",
  internal: "INTERNAL",
} as const;
export type StorageAdminErrorCode = (typeof STORAGE_ADMIN_ERROR)[keyof typeof STORAGE_ADMIN_ERROR];

export const STORAGE_ADMIN_STATUS: Readonly<Record<StorageAdminErrorCode, number>> = {
  ADMIN_OFF: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_SETTING: 422,
  INTERNAL: 500,
};

/** A typed refusal. The message is the code: never a value, a key or an address. */
export class StorageAdminError extends Error {
  constructor(readonly code: StorageAdminErrorCode) {
    super(code);
    this.name = "StorageAdminError";
  }
}
