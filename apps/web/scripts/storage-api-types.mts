// Writes lib/storage/storage-api.generated.d.ts from the OpenAPI document (`pnpm --filter @kridoc/web storage:types`).
import { writeFile } from "node:fs/promises";

import { generatedStorageApiTypes, STORAGE_API_TYPES_FILE } from "../lib/storage/storage-api-types";

await writeFile(STORAGE_API_TYPES_FILE, await generatedStorageApiTypes());
console.log("storage-api: types written to lib/storage/storage-api.generated.d.ts");
