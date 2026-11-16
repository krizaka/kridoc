import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { STORAGE_API_VERSION } from "./storage-api";
import { generatedStorageApiTypes, STORAGE_API_DOCUMENT, STORAGE_API_TYPES_FILE } from "./storage-api-types";

describe("the storage API's generated types (krizaka-internal#4041)", () => {
  it("match the OpenAPI document: after changing the document run `pnpm --filter @kridoc/web storage:types`", async () => {
    expect(await generatedStorageApiTypes()).toBe(await readFile(STORAGE_API_TYPES_FILE, "utf8"));
  });

  it("say what the routes say: paths, the pages, the quota refusal", async () => {
    const types = await readFile(STORAGE_API_TYPES_FILE, "utf8");
    for (const path of ["/api/storage/v1/ping", "/api/storage/v1/usage", "/api/storage/v1/objects"])
      expect(types).toContain(`"${path}"`);
    expect(types).toContain("STORAGE_QUOTA_EXCEEDED");
    expect(types).toContain("next: string | null");
  });

  it("the document's version is the one `GET /ping` tells", async () => {
    const document = await readFile(STORAGE_API_DOCUMENT, "utf8");
    expect(document).toMatch(new RegExp(`^  version: ${STORAGE_API_VERSION.replaceAll(".", "\\.")}$`, "m"));
  });
});
