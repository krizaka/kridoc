/** The refusals of the documents feature: a stable code each, its HTTP status said once here, its words in messages/<locale>.json (`documents.errors.<code>`). */
export const DOCUMENT_ERROR = {
  documentsOff: "DOCUMENTS_OFF",
  notFound: "DOCUMENT_NOT_FOUND",
  noFile: "NO_FILE",
  tooBig: "FILE_TOO_BIG",
  badType: "FILE_TYPE_REFUSED",
  unauthenticated: "UNAUTHENTICATED",
  internal: "INTERNAL",
} as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR)[keyof typeof DOCUMENT_ERROR];

export const DOCUMENT_STATUS: Readonly<Record<DocumentErrorCode, number>> = {
  DOCUMENTS_OFF: 404,
  DOCUMENT_NOT_FOUND: 404,
  NO_FILE: 400,
  FILE_TOO_BIG: 413,
  FILE_TYPE_REFUSED: 415,
  UNAUTHENTICATED: 401,
  INTERNAL: 500,
};

/** A typed refusal. The message is the code: never a title, a key or a byte of the document. */
export class DocumentError extends Error {
  constructor(readonly code: DocumentErrorCode) {
    super(code);
    this.name = "DocumentError";
  }
}
