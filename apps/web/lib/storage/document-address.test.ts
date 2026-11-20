import { describe, expect, it } from "vitest";

import { documentAuditOf, documentIdOfKey, documentKeyOf, isDocumentId } from "./document-address";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("document address", () => {
  it("round-trips an id through its key", () => {
    expect(documentIdOfKey(documentKeyOf(ID))).toBe(ID);
  });

  it("reads a key that is not a document's as null", () => {
    expect(documentIdOfKey("avatars/me.png")).toBeNull();
    expect(documentIdOfKey("documents/not-an-id")).toBeNull();
    expect(documentIdOfKey(ID)).toBeNull();
  });

  it("accepts a uuid in either case, one rule", () => {
    expect(isDocumentId(ID)).toBe(true);
    expect(isDocumentId(ID.toUpperCase())).toBe(true);
    expect(isDocumentId("nope")).toBe(false);
  });

  it("builds the audit identity from the key", () => {
    const audit = documentAuditOf("owner-1", ID);
    expect(audit.tenantId).toContain("owner-1");
    expect(audit.keyHash).not.toContain(ID);
  });
});
