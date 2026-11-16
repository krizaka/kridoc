import { RateLimited } from "@krizaka/rate-limit";
import { STORAGE_CODE, StorageError } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { STORAGE_API_ERROR, StorageApiError } from "./api-errors";
import {
  bearerOf,
  boundedBody,
  keyOfSegments,
  objectResponse,
  pageOf,
  requestIdOf,
  storageApiCodeOf,
  storageApiRefusal,
  withRequestId,
} from "./api-http";

const URL_ = "https://www.kridoc.com/api/storage/v1/objects/a";

describe("the storage API's HTTP edge", () => {
  it("reads a bearer token and nothing else", () => {
    expect(bearerOf(new Headers({ authorization: "Bearer kst1.abc" }))).toBe("kst1.abc");
    expect(bearerOf(new Headers({ authorization: "bearer kst1.abc" }))).toBe("kst1.abc");
    for (const value of ["", "Basic abc", "Bearer", "Bearer a b", "kst1.abc"])
      expect(bearerOf(new Headers({ authorization: value }))).toBeUndefined();
    expect(bearerOf(new Headers())).toBeUndefined();
  });

  it("refuses a body over the bound, declared or streamed, and reads one under it", async () => {
    await expect(
      boundedBody(new Request(URL_, { method: "PUT", body: "12345", headers: { "content-length": "5" } }), 4),
    ).rejects.toMatchObject({ code: STORAGE_API_ERROR.tooBig });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
        controller.close();
      },
    });
    await expect(
      boundedBody(new Request(URL_, { method: "PUT", body: stream, duplex: "half" } as RequestInit), 4),
    ).rejects.toMatchObject({ code: STORAGE_API_ERROR.tooBig });
    expect([...(await boundedBody(new Request(URL_, { method: "PUT", body: "abc" }), 4))]).toEqual([97, 98, 99]);
    expect((await boundedBody(new Request(URL_), 4)).byteLength).toBe(0);
  });

  it("maps every refusal once: the limiter's with Retry-After, a missing token with the Bearer scheme", async () => {
    const limited = storageApiRefusal(new RateLimited(30, "subject"), new Request(URL_));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
    const anonymous = storageApiRefusal(new StorageApiError(STORAGE_API_ERROR.unauthenticated), new Request(URL_));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe('Bearer realm="kridoc-storage"');
    expect(storageApiCodeOf(new StorageError(STORAGE_CODE.badKey, "k"))).toBe(STORAGE_API_ERROR.keyRefused);
    expect(storageApiCodeOf(new StorageError(STORAGE_CODE.shredded, "k"))).toBe(STORAGE_API_ERROR.notFound);
    expect(storageApiCodeOf(new StorageError(STORAGE_CODE.unreadable, "k"))).toBe(STORAGE_API_ERROR.internal);
    const french = storageApiRefusal(new Error("a key"), new Request(URL_, { headers: { "accept-language": "fr" } }));
    expect(french.status).toBe(500);
    expect(JSON.stringify(await french.json())).not.toContain("a key");
  });

  it("serves an object as an attachment that is never sniffed, rendered or cached", () => {
    const response = objectResponse({
      bytes: new Uint8Array([1, 2]),
      contentType: "application/pdf",
      sha256: "0".repeat(64),
    });
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/pdf",
      "content-length": "2",
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    expect(keyOfSegments(["a", "b.pdf"])).toBe("a/b.pdf");
  });

  describe("X-Request-Id (krizaka-internal#4041)", () => {
    it("echoes a valid incoming id and generates one otherwise", () => {
      expect(requestIdOf(new Headers({ "x-request-id": "req-1234.abc_XYZ" }))).toBe("req-1234.abc_XYZ");
      for (const bad of ["", "a b", "x".repeat(129), "é", "a;b"]) {
        const id = requestIdOf(new Headers({ "x-request-id": bad }));
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
      }
      expect(requestIdOf(new Headers())).not.toBe(requestIdOf(new Headers()));
    });

    it("is on every answer, and in the `instance` of a refusal", async () => {
      const id = "req-77777777";
      const refused = withRequestId(
        storageApiRefusal(new StorageApiError(STORAGE_API_ERROR.notFound), new Request(URL_), id),
        id,
      );
      expect(refused.headers.get("x-request-id")).toBe(id);
      expect(refused.status).toBe(404);
      expect((await refused.json()).instance).toBe(`urn:kridoc:request:${id}`);
      expect(withRequestId(new Response("x", { status: 201 }), id).status).toBe(201);
    });
  });

  describe("pageOf: `after` and `limit` of a list", () => {
    it("reads them from the query; a limit that is not a whole number is refused", () => {
      expect(pageOf(new URLSearchParams("after=a/b.pdf&limit=5"))).toEqual({ after: "a/b.pdf", limit: 5 });
      expect(pageOf(new URLSearchParams(""))).toEqual({});
      for (const limit of ["x", "0", "-2", "1.5", ""])
        expect(() => pageOf(new URLSearchParams({ limit }))).toThrowError(
          expect.objectContaining({ code: STORAGE_API_ERROR.invalidInput }),
        );
    });
  });
});
