import { STORAGE_CODE, StorageError } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { AUTH_ERROR, AuthError } from "@/lib/auth/errors";

import { DOCUMENT_ERROR, DocumentError } from "./errors";
import { attachmentOf, documentCodeOf, documentRefusal, downloadOf } from "./http";

const request = (language = "fr") =>
  new Request("https://www.kridoc.com/api/documents", { headers: { "accept-language": language } });

describe("the documents' refusals", () => {
  it("map the storage library's and the accounts' refusals to the feature's codes", () => {
    expect(documentCodeOf(new StorageError(STORAGE_CODE.tooBig, "x"))).toBe(DOCUMENT_ERROR.tooBig);
    expect(documentCodeOf(new StorageError(STORAGE_CODE.noFile, "x"))).toBe(DOCUMENT_ERROR.noFile);
    expect(documentCodeOf(new StorageError(STORAGE_CODE.typeMismatch, "x"))).toBe(DOCUMENT_ERROR.badType);
    expect(documentCodeOf(new StorageError(STORAGE_CODE.provider, "x"))).toBe(DOCUMENT_ERROR.internal);
    expect(documentCodeOf(new AuthError(AUTH_ERROR.accountsOff))).toBe(DOCUMENT_ERROR.documentsOff);
    expect(documentCodeOf(new AuthError(AUTH_ERROR.unauthenticated))).toBe(DOCUMENT_ERROR.unauthenticated);
    expect(documentCodeOf(new AuthError(AUTH_ERROR.emailTaken))).toBe(DOCUMENT_ERROR.internal);
    expect(documentCodeOf(new Error("a driver message"))).toBe(DOCUMENT_ERROR.internal);
  });
  it("answer Problem Details in the visitor's language, never a provider's message", async () => {
    const tooBig = documentRefusal(new DocumentError(DOCUMENT_ERROR.tooBig), request("en"));
    expect(tooBig.status).toBe(413);
    expect(tooBig.headers.get("content-type")).toBe("application/problem+json");
    expect(await tooBig.json()).toMatchObject({ code: "FILE_TOO_BIG", detail: "This file is too large." });
    const failed = documentRefusal(new StorageError(STORAGE_CODE.provider, "the bucket refused key t/x"), request());
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("t/x");
  });
});

describe("a document's download", () => {
  it("is an attachment with its title in ASCII and in UTF-8", () => {
    expect(attachmentOf("Bail été 2026.pdf")).toBe(
      `attachment; filename="Bail _t_ 2026.pdf"; filename*=UTF-8''Bail%20%C3%A9t%C3%A9%202026.pdf`,
    );
    expect(attachmentOf('a"b\\c')).toBe(`attachment; filename="a_b_c"; filename*=UTF-8''a%22b%5Cc`);
  });
  it("carries its type, is never cached, sniffed or rendered as a page", async () => {
    const response = downloadOf(new Uint8Array([37, 80, 68, 70]), "application/pdf", "bail.pdf");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([37, 80, 68, 70]);
  });
});
