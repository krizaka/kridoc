import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STORAGE_API_ERROR } from "@/lib/storage/api-errors";

/**
 * The OpenAPI document Verikora generates its client types from (docs/architecture/kridoc-storage-api.v1.openapi.yaml) says what the
 * routes do: every route and method is in it, every refusal code too. A route or a code added without the document fails here.
 */
const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const ROUTES = join(ROOT, "apps/web/app/api/storage/v1");
const METHODS = ["GET", "PUT", "HEAD", "DELETE", "POST"] as const;

async function routeFiles(dir: string, path = ""): Promise<{ path: string; file: string }[]> {
  const found: { path: string; file: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const segment = entry.name.replace(/^\[\.\.\.(\w+)\]$/, "{$1}");
    if (entry.isDirectory()) found.push(...(await routeFiles(join(dir, entry.name), `${path}/${segment}`)));
    else if (entry.name === "route.ts") found.push({ path: `/api/storage/v1${path}`, file: join(dir, entry.name) });
  }
  return found;
}

describe("the storage API's OpenAPI document", async () => {
  const document = await readFile(join(ROOT, "docs/architecture/kridoc-storage-api.v1.openapi.yaml"), "utf8");
  const routes = await routeFiles(ROUTES);

  it("finds the routes", () => {
    expect(routes.map((r) => r.path).sort()).toEqual([
      "/api/storage/v1/links/{key}",
      "/api/storage/v1/objects",
      "/api/storage/v1/objects/{key}",
      "/api/storage/v1/ping",
      "/api/storage/v1/usage",
    ]);
  });

  for (const route of routes)
    it(`describes every method of ${route.path}`, async () => {
      const source = await readFile(route.file, "utf8");
      const block = `\n${document.split(`\n  ${route.path}:\n`)[1]?.split(/\n {2}\/api\//)[0] ?? ""}`;
      expect(block.trim(), route.path).not.toBe("");
      for (const method of METHODS.filter((m) => source.includes(`export async function ${m}(`)))
        expect(block, `${method} ${route.path}`).toContain(`\n    ${method.toLowerCase()}:\n`);
    });

  it("lists every refusal code", () => {
    for (const code of Object.values(STORAGE_API_ERROR)) expect(document).toContain(`- ${code}\n`);
  });
});
