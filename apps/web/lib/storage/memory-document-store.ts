import type { DocumentRecord, DocumentStore, NewDocument } from "./document-port";

// @fixed: the date every in-memory row carries, so a test can compare whole records
const AT = new Date("2026-11-15T10:00:00Z");

/** The metadata port in memory (tests), with the same owner rule as the SQL adapter (lib/db/document-store.ts, tested on PostgreSQL). */
export function memoryDocumentStore(): DocumentStore & { failNextAdd(): void } {
  const rows = new Map<string, DocumentRecord>();
  let fail = false;
  return {
    failNextAdd: () => {
      fail = true;
    },
    async add(document: NewDocument) {
      if (fail) {
        fail = false;
        throw new Error("the database refused the insert");
      }
      const record = { ...document, id: document.id ?? `id-${rows.size}`, createdAt: AT };
      rows.set(record.id, record);
      return record;
    },
    listByOwner: async (ownerId) => [...rows.values()].filter((r) => r.ownerId === ownerId),
    findForOwner: async (ownerId, id) => (rows.get(id)?.ownerId === ownerId ? rows.get(id)! : null),
    async removeForOwner(ownerId, id) {
      if (rows.get(id)?.ownerId !== ownerId) return false;
      return rows.delete(id);
    },
  };
}
