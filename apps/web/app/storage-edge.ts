import { type KeyAuditNote, STORAGE_CODE, StorageError } from "@krizaka/storage";

import type { Env } from "@/lib/env";
import type { StorageConfig } from "@/lib/storage/object-store";
import { STORAGE_PROVIDER } from "@/lib/storage/providers";

// The installation's store, as the environment says, shared by Kridoc's documents (documents-edge.ts) and the products' storage API
// (storage-api-edge.ts). Nothing here reads a session: the products' API and its CLI need no accounts.

/** The tenant of a development or test installation, when MEDIA_DOCUMENTS_TENANT is not set (production refuses to start without it). */
// @fixed: the name of the development tenant, never a production one
export const DEV_TENANT = "kridoc-dev";

/** A bucket setting that must be there: a provider chosen without it is refused loudly, never replaced by another. */
const needed = (value: string | undefined, key: string): string => {
  if (!value) throw new StorageError(STORAGE_CODE.badConfig, `${key} is not set (MEDIA_STORAGE_PROVIDER is s3)`);
  return value;
};

/**
 * The configuration of the documents' store from the parsed environment (the edge reads it, nothing below does).
 * @throws StorageError `STORAGE_BAD_CONFIG` for the s3 provider without one of its settings
 */
export function storageConfigOf(env: Env): StorageConfig {
  const tenant = env.MEDIA_DOCUMENTS_TENANT ?? DEV_TENANT;
  if (env.MEDIA_STORAGE_PROVIDER === STORAGE_PROVIDER.local)
    return { provider: STORAGE_PROVIDER.local, tenant, root: env.MEDIA_STORAGE_ROOT };
  return {
    provider: STORAGE_PROVIDER.s3,
    tenant,
    bucket: {
      endpoint: needed(env.MEDIA_S3_ENDPOINT, "MEDIA_S3_ENDPOINT"),
      region: needed(env.MEDIA_S3_REGION, "MEDIA_S3_REGION"),
      bucket: needed(env.MEDIA_S3_BUCKET, "MEDIA_S3_BUCKET"),
      accessKeyId: needed(env.MEDIA_S3_ACCESS_KEY_ID, "MEDIA_S3_ACCESS_KEY_ID"),
      secretAccessKey: needed(env.MEDIA_S3_SECRET_ACCESS_KEY, "MEDIA_S3_SECRET_ACCESS_KEY"),
    },
  };
}

/**
 * The root key of the documents' keys, from the secret store through the environment. Without it the feature refuses to run (production
 * refuses to boot, lib/env.ts): a document is never kept unsealed.
 */
export function vaultRootKeyOf(env: Env): string {
  if (!env.MEDIA_VAULT_KEY)
    throw new StorageError(STORAGE_CODE.badConfig, "MEDIA_VAULT_KEY is not set (the documents feature is on)");
  return env.MEDIA_VAULT_KEY;
}

/** A key event, until @krizaka/audit is wired (the admin slice): the action, the account's tenant and the numbers, never a key. */
export const logKeyEvent = async (note: KeyAuditNote): Promise<void> => {
  console.info(`documents: ${note.action} ${note.target.id} ${JSON.stringify(note.detail)}`);
};
