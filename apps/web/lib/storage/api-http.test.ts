import { RateLimited } from "@krizaka/rate-limit";
import { STORAGE_CODE, StorageError } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { STORAGE_API_ERROR, StorageApiError } from "./api-errors";
import { bearerOf, boundedBody, keyOfSegments, objectResponse, storageApiCodeOf, storageApiRefusal } from "./api-http";

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
});
