import { STORAGE_CODE, StorageError } from "@krizaka/storage";

import { AUTH_ERROR, AuthError } from "@/lib/auth/errors";
import { localeOfRequest, problemOf } from "@/lib/auth/http";
import { storedFileHeaders } from "@/lib/http/stored-file";
import { getDictionary } from "@/lib/i18n";

import { DOCUMENT_ERROR, DOCUMENT_STATUS, DocumentError, type DocumentErrorCode } from "./errors";

/** The refusals of @krizaka/storage a document route can meet, as the feature's codes. */
const FROM_STORAGE: Partial<Record<string, DocumentErrorCode>> = {
  [STORAGE_CODE.tooBig]: DOCUMENT_ERROR.tooBig,
  [STORAGE_CODE.noFile]: DOCUMENT_ERROR.noFile,
  [STORAGE_CODE.badType]: DOCUMENT_ERROR.badType,
  [STORAGE_CODE.typeMismatch]: DOCUMENT_ERROR.badType,
};

/** The accounts' refusals a document route can meet: the accounts feature off is the documents feature off (nothing is named). */
const FROM_AUTH: Partial<Record<string, DocumentErrorCode>> = {
  [AUTH_ERROR.accountsOff]: DOCUMENT_ERROR.documentsOff,
  [AUTH_ERROR.unauthenticated]: DOCUMENT_ERROR.unauthenticated,
};

export function documentCodeOf(error: unknown): DocumentErrorCode {
  if (error instanceof DocumentError) return error.code;
  if (error instanceof StorageError) return FROM_STORAGE[error.code] ?? DOCUMENT_ERROR.internal;
  if (error instanceof AuthError) return FROM_AUTH[error.code] ?? DOCUMENT_ERROR.internal;
  return DOCUMENT_ERROR.internal;
}

/** The one place a documents refusal becomes an HTTP answer: status from the code, words from the catalogue in the visitor's language. */
export function documentRefusal(error: unknown, request: Request): Response {
  const code = documentCodeOf(error);
  // Only the kind of failure is logged: never a message (a provider's can carry a key), a title or a byte.
  if (code === DOCUMENT_ERROR.internal)
    console.error(`documents: unexpected failure (${error instanceof Error ? error.name : typeof error})`);
  return problemOf(code, DOCUMENT_STATUS[code], getDictionary(localeOfRequest(request)).documents.errors[code]);
}

/** `Content-Disposition` of a download: always an attachment, the title as an ASCII fallback and in UTF-8 (RFC 6266). */
export function attachmentOf(title: string): string {
  const ascii = title.replace(/[^A-Za-z0-9._ -]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(title)}`;
}

/** A document's bytes as the answer: its sniffed type, never rendered inline, never cached, never sniffed again by the browser. */
export function downloadOf(bytes: Uint8Array, mediaType: string, title: string): Response {
  return new Response(bytes.slice(), {
    headers: {
      "Content-Type": mediaType,
      "Content-Length": String(bytes.byteLength),
      ...storedFileHeaders(attachmentOf(title)),
    },
  });
}
