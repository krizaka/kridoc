import { pathToFileURL } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

/** apps/web: where `pnpm` and vitest run (a bundled script has no useful `import.meta.url`). */
const PACKAGE_DIR = pathToFileURL(`${process.cwd()}/`);

/** The OpenAPI document of the storage API: the contract products generate their client from. */
export const STORAGE_API_DOCUMENT = new URL("../../docs/architecture/kridoc-storage-api.v1.openapi.yaml", PACKAGE_DIR);

/** The generated TypeScript types, committed beside the code that uses them; a test fails when they drift from the document. */
export const STORAGE_API_TYPES_FILE = new URL("lib/storage/storage-api.generated.d.ts", PACKAGE_DIR);

/** The types of the document, as openapi-typescript writes them. */
export async function generatedStorageApiTypes(): Promise<string> {
  return astToString(await openapiTS(STORAGE_API_DOCUMENT));
}
