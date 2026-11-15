import { describe, expect, it } from "vitest";

import { GET as readLink, POST as signLink } from "./v1/links/[...key]/route";
import { DELETE as deleteOne, GET as readOne, HEAD as headOne, PUT as putOne } from "./v1/objects/[...key]/route";
import { GET as listObjects } from "./v1/objects/route";

const BASE = "https://www.kridoc.com/api/storage/v1";
const params = { params: Promise.resolve({ key: ["docs", "a.pdf"] }) };
const TOKEN = { authorization: `Bearer kst1.${"a".repeat(43)}` };

/** The storage API is behind MEDIA_STORAGE_ENABLED, off by default: no route answers, whatever is sent; no token or body is read. */
describe("the storage API routes while MEDIA_STORAGE_ENABLED is off (the default)", () => {
  for (const [name, call] of [
    [
      "put",
      () => putOne(new Request(`${BASE}/objects/docs/a.pdf`, { method: "PUT", body: "x", headers: TOKEN }), params),
    ],
    ["get", () => readOne(new Request(`${BASE}/objects/docs/a.pdf`, { headers: TOKEN }), params)],
    ["head", () => headOne(new Request(`${BASE}/objects/docs/a.pdf`, { method: "HEAD", headers: TOKEN }), params)],
    [
      "delete",
      () => deleteOne(new Request(`${BASE}/objects/docs/a.pdf`, { method: "DELETE", headers: TOKEN }), params),
    ],
    ["list", () => listObjects(new Request(`${BASE}/objects`, { headers: TOKEN }))],
    ["sign", () => signLink(new Request(`${BASE}/links/docs/a.pdf`, { method: "POST", headers: TOKEN }), params)],
    ["read a link", () => readLink(new Request(`${BASE}/links/docs/a.pdf?client=x&expires=1&signature=y`), params)],
  ] as const) {
    it(`${name} answers 404`, async () => {
      const response = await call();
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("STORAGE_API_OFF");
    });
  }
});
