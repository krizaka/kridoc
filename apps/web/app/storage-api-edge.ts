import { createLimiter, memoryLimitStore } from "@krizaka/rate-limit";
import { dbTenantKeyStore, parseVaultKey, tenantStore } from "@krizaka/storage";

import { databaseOf } from "@/lib/db/connection";
import { createStorageClientStore } from "@/lib/db/storage-client-store";
import { type Env, readEnv, SETTINGS } from "@/lib/env";
import { STORAGE_API_ERROR, StorageApiError } from "@/lib/storage/api-errors";
import { bearerOf, storageApiRefusal } from "@/lib/storage/api-http";
import type { StorageClient } from "@/lib/storage/client-port";
import { clientTokensOf } from "@/lib/storage/client-tokens";
import { derivedSecretOf, SECRET_PURPOSE } from "@/lib/storage/derived-secrets";
import { installationVaultOf } from "@/lib/storage/document-vault";
import { objectStoreOf, platformFetch } from "@/lib/storage/object-store";
import { signedLinksOf } from "@/lib/storage/signed-links";
import { createStorageApi, type LinkQuery, STORAGE_API_ACTION, type StorageApi } from "@/lib/storage/storage-api";
import { createStorageClients, type StorageClients } from "@/lib/storage/storage-clients";
import type { StorageRulesSource } from "@/lib/storage/storage-settings";

import { logKeyEvent, storageConfigOf, vaultRootKeyOf } from "./storage-edge";
import { storageRulesFor, storageTrailOf } from "./storage-rules-edge";
import { systemClock } from "./system-clock";

/** The path of the signed links (app/api/storage/v1/links/[...key]). */
// @fixed: the route of the signed links, versioned with the API
export const LINKS_PATH = "/api/storage/v1/links";

/** The limiter lives as long as the process: its counters are this instance's (a shared store is a follow-up when there are several). */
const limiter = createLimiter({
  store: memoryLimitStore(),
  clock: systemClock,
  limits: { [STORAGE_API_ACTION]: { ...SETTINGS.storageApi.rateLimit } },
  onStoreError: (_error, action) => console.error(`storage-api: the limiter failed on ${action}`),
});

/** A signed link's absolute address: the key in the path (each segment encoded), the claim in the query. */
export function linkUrlOf(origin: string, query: LinkQuery): string {
  const url = new URL(`${LINKS_PATH}/${query.key.split("/").map(encodeURIComponent).join("/")}`, origin);
  for (const name of ["client", "expires", "signature"] as const) url.searchParams.set(name, query[name]);
  return url.toString();
}

export interface StorageApiRuntime {
  api: StorageApi;
  clients: StorageClients;
  /** The administrator's rules, asked by the route for the size it reads (the service asks again for the types and the link's life). */
  rules: StorageRulesSource;
  env: Env;
}

/**
 * The products' clients over Kridoc's database: issued and revoked by `pnpm storage:client`, authenticated by every API call. Their
 * tokens' hashes are keyed by a secret derived from the root key (`MEDIA_VAULT_KEY`). Needs no accounts and no bucket.
 */
export function storageClientsOf(env: Env): StorageClients {
  const { query } = databaseOf(env);
  return createStorageClients({
    store: createStorageClientStore(query),
    tokens: clientTokensOf(derivedSecretOf(parseVaultKey(vaultRootKeyOf(env)), SECRET_PURPOSE.clientToken)),
    clock: systemClock,
    audit: storageTrailOf(env).audit,
  });
}

/**
 * Builds the storage API of the other products; refuses when the feature is off (before anything else: no token is read). The only
 * place that reads the environment for it. Products' tenants share the installation's store and keyring with Kridoc's accounts.
 */
export function storageApiRuntime(env: Env = readEnv()): StorageApiRuntime {
  if (env.MEDIA_STORAGE_ENABLED !== "on") throw new StorageApiError(STORAGE_API_ERROR.off);
  const { query } = databaseOf(env);
  const rootKey = vaultRootKeyOf(env);
  const vault = installationVaultOf({ rootKey, keys: dbTenantKeyStore(query), clock: systemClock, audit: logKeyEvent });
  const installation = objectStoreOf(storageConfigOf(env), { fetch: platformFetch, clock: systemClock });
  const clients = storageClientsOf(env);
  const rules = storageRulesFor(env);
  const api = createStorageApi({
    clients,
    objectsOf: (tenantId) => tenantStore(installation, vault, tenantId),
    limiter,
    links: signedLinksOf(derivedSecretOf(parseVaultKey(rootKey), SECRET_PURPOSE.signedLink)),
    clock: systemClock,
    audit: storageTrailOf(env).audit,
    limits: SETTINGS.storageApi,
    rules,
  });
  return { api, clients, rules, env };
}

/** A route of a product's client, whole: the feature check, the token (and the limiter), then the route's one service call. */
export async function storageApiRoute(
  request: Request,
  work: (context: StorageApiRuntime & { client: StorageClient }) => Promise<Response>,
): Promise<Response> {
  try {
    const runtime = storageApiRuntime();
    const client = await runtime.api.authenticate(bearerOf(request.headers));
    return await work({ ...runtime, client });
  } catch (error) {
    return storageApiRefusal(error, request);
  }
}

/** The route of a signed link: no token, the link's own signature; the same refusals. */
export async function storageLinkRoute(
  request: Request,
  work: (runtime: StorageApiRuntime) => Promise<Response>,
): Promise<Response> {
  try {
    return await work(storageApiRuntime());
  } catch (error) {
    return storageApiRefusal(error, request);
  }
}
