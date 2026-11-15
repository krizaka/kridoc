import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * The journeys of the product through a real browser (`pnpm test:e2e`): the app in development mode on a throwaway port, over a real
 * PostgreSQL named by DATABASE_URL (the journeys make and drop their own database `kridoc_e2e` on it), the local storage adapter in a
 * temporary folder. Never production, never a real secret: every value below is made up for the run.
 */
const PORT = 3107;
const BASE_URL = `http://localhost:${PORT}`;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set: the journeys never skip");
const database = new URL(url);
database.pathname = "/kridoc_e2e";

export default defineConfig({
  testDir: "e2e",
  testMatch: /\.journey\.mts$/,
  globalSetup: "./e2e/database.setup.mts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE_URL },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `${BASE_URL}/api/healthz`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      AUTH_ENABLED: "on",
      DATABASE_ENABLED: "on",
      DATABASE_URL: database.toString(),
      AUTH_SESSION_SECRET: randomBytes(32).toString("hex"),
      MEDIA_STORAGE_ENABLED: "on",
      MEDIA_STORAGE_PROVIDER: "local",
      MEDIA_STORAGE_ROOT: mkdtempSync(join(tmpdir(), "kridoc-e2e-")),
      MEDIA_DOCUMENTS_TENANT: "kridoc-e2e",
      MEDIA_VAULT_KEY: randomBytes(32).toString("base64"),
    },
  },
});
