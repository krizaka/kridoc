import { join } from "node:path";

import { type Clock } from "@krizaka/db";
import { bucketStore, checkEndpoint, type FetchLike, folderStore, type ObjectStore } from "@krizaka/storage";

import { STORAGE_PROVIDER } from "./providers";

/** The platform's `fetch` as the adapters' `FetchLike`: the body is copied once into its own buffer, which `fetch` accepts without a cast. */
export const platformFetch: FetchLike = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, ...(init.body ? { body: init.body.slice() } : {}) });

/** The bucket of the `s3` provider: coordinates and its key. */
export interface BucketConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Where the documents' bytes live, as the edge read it from the environment. */
export type StorageConfig =
  | { provider: typeof STORAGE_PROVIDER.local; tenant: string; root: string }
  | { provider: typeof STORAGE_PROVIDER.s3; tenant: string; bucket: BucketConfig };

/**
 * The `ObjectStore` of @krizaka/storage for an installation: every key lives under its tenant (a folder `<root>/<tenant>/`, or the
 * bucket prefix `t/<tenant>/`), so one installation can never name another's objects. The bucket asks for encryption at rest.
 */
export function objectStoreOf(config: StorageConfig, deps: { fetch: FetchLike; clock: Clock }): ObjectStore {
  if (config.provider === STORAGE_PROVIDER.local) return folderStore({ root: join(config.root, config.tenant) });
  return bucketStore({
    ...config.bucket,
    endpoint: checkEndpoint(config.bucket.endpoint),
    prefix: `t/${config.tenant}`,
    serverSideEncryption: true,
    ...deps,
  });
}

/**
 * The quarantine of the same installation: a store of its own (a folder beside the documents', or the bucket prefix `t/<tenant>-quarantine/`) where
 * an upload waits for its checks. Nothing else reads it, and the bucket's lifecycle expires it after a day.
 */
export function quarantineStoreOf(config: StorageConfig, deps: { fetch: FetchLike; clock: Clock }): ObjectStore {
  return objectStoreOf({ ...config, tenant: `${config.tenant}-quarantine` }, deps);
}
