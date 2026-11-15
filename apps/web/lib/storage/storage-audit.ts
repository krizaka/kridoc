import { createHash } from "node:crypto";

/** The audit lines of the storage API (design note « Audit »): by client and tenant, never by token, never by a key's words. */
export const STORAGE_AUDIT = {
  issued: "storage.client.issued",
  revoked: "storage.client.revoked",
  put: "storage.object.put",
  read: "storage.object.read",
  head: "storage.object.head",
  listed: "storage.object.listed",
  deleted: "storage.object.deleted",
  signed: "storage.object.signed",
  linkRead: "storage.object.link-read",
} as const;
export type StorageAuditAction = (typeof STORAGE_AUDIT)[keyof typeof STORAGE_AUDIT];

export interface StorageAuditLine {
  action: StorageAuditAction;
  clientId: string;
  tenantId: string;
  /** The SHA-256 of the key, 16 hex characters: the same object is followed across lines, its name is never written. */
  keyHash?: string;
  /** Sizes and counts, never content. */
  detail?: Readonly<Record<string, number | string>>;
}

export type StorageAudit = (line: StorageAuditLine) => Promise<void>;

// @fixed: 64 bits of the key's hash tell objects apart in a log without naming them
const KEY_HASH_CHARS = 16;

export const keyHashOf = (key: string): string =>
  createHash("sha256").update(key).digest("hex").slice(0, KEY_HASH_CHARS);
