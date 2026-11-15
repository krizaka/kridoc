import { describe, expect, it } from "vitest";

import { DELETE as deleteOne, GET as readOne } from "./[id]/route";
import { GET as list, POST as upload } from "./route";

const params = { params: Promise.resolve({ id: "00000000-0000-4000-8000-00000000000a" }) };

/** The documents feature is off by default: no document route answers, whatever is sent, and no session or body is read. */
describe("the document routes while MEDIA_STORAGE_ENABLED is off (the default)", () => {
  for (const [name, call] of [
    ["list", () => list(new Request("https://www.kridoc.com/api/documents"))],
    [
      "upload",
      () => upload(new Request("https://www.kridoc.com/api/documents", { method: "POST", body: "not a form" })),
    ],
    ["read", () => readOne(new Request("https://www.kridoc.com/api/documents/x"), params)],
    ["delete", () => deleteOne(new Request("https://www.kridoc.com/api/documents/x", { method: "DELETE" }), params)],
  ] as const) {
    it(`${name} answers 404`, async () => {
      const response = await call();
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("DOCUMENTS_OFF");
    });
  }
});
