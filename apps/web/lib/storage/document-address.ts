import { z } from "zod";

import { accountTenantOf } from "./document-vault";
import { keyHashOf } from "./storage-audit";

/** The address of a Kridoc document: its id, its key in the owner's store, and its audit identity. The one place that builds or parses them. */
const DOCUMENT_PREFIX = "documents/";

/** The one rule for what a document id is. */
export const isDocumentId = (id: string): boolean => z.uuid().safeParse(id).success;

/** The key of a document in its owner's store. */
export const documentKeyOf = (id: string): string => `${DOCUMENT_PREFIX}${id}`;

/** The inverse of `documentKeyOf`: the id, or null for a key that is not a document's. */
export const documentIdOfKey = (key: string): string | null => {
  if (!key.startsWith(DOCUMENT_PREFIX)) return null;
  const id = key.slice(DOCUMENT_PREFIX.length);
  return isDocumentId(id) ? id : null;
};

/** The prefix under which a store lists its documents. */
export const DOCUMENT_KEY_PREFIX = DOCUMENT_PREFIX;

/** The tenant and key hash that identify a document in the audit trail. */
export const documentAuditOf = (ownerId: string, id: string) => ({
  tenantId: accountTenantOf(ownerId),
  keyHash: keyHashOf(documentKeyOf(id)),
});
