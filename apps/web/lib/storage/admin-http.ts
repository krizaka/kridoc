import { AUTH_ERROR, AuthError } from "@/lib/auth/errors";
import { localeOfRequest, problemOf } from "@/lib/auth/http";
import { getDictionary } from "@/lib/i18n";

import {
  STORAGE_ADMIN_ERROR,
  STORAGE_ADMIN_STATUS,
  StorageAdminError,
  type StorageAdminErrorCode,
} from "./admin-errors";

/** The accounts' refusals the admin can meet: the accounts feature off is the admin off (nothing is named). */
const FROM_AUTH: Partial<Record<string, StorageAdminErrorCode>> = {
  [AUTH_ERROR.accountsOff]: STORAGE_ADMIN_ERROR.off,
  [AUTH_ERROR.unauthenticated]: STORAGE_ADMIN_ERROR.unauthenticated,
  [AUTH_ERROR.invalidInput]: STORAGE_ADMIN_ERROR.invalid,
};

export function adminCodeOf(error: unknown): StorageAdminErrorCode {
  if (error instanceof StorageAdminError) return error.code;
  if (error instanceof AuthError) return FROM_AUTH[error.code] ?? STORAGE_ADMIN_ERROR.internal;
  return STORAGE_ADMIN_ERROR.internal;
}

/** The one place an admin refusal becomes an HTTP answer: status from the code, words from the catalogue in the visitor's language. */
export function adminRefusal(error: unknown, request: Request): Response {
  const code = adminCodeOf(error);
  // Only the kind of failure is logged: never a message (a driver's can carry a value) or a body.
  if (code === STORAGE_ADMIN_ERROR.internal)
    console.error(`storage-admin: unexpected failure (${error instanceof Error ? error.name : typeof error})`);
  return problemOf(code, STORAGE_ADMIN_STATUS[code], getDictionary(localeOfRequest(request)).storageAdmin.errors[code]);
}
