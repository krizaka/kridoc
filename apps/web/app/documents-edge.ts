import { randomUUID } from "node:crypto";

import { dbTenantKeyStore, type KeyAuditNote, STORAGE_CODE, StorageError } from "@krizaka/storage";

import { tokenOfRequest } from "@/lib/auth/session-cookie";
import { databaseOf } from "@/lib/db/connection";
import { createDocumentStore } from "@/lib/db/document-store";
import { type Env, readEnv, SETTINGS } from "@/lib/env";
import { createDocumentService, type DocumentService } from "@/lib/storage/document-service";
import { ownerObjectsOf } from "@/lib/storage/document-vault";
import { DOCUMENT_ERROR, DocumentError } from "@/lib/storage/errors";
import { documentRefusal } from "@/lib/storage/http";
import { objectStoreOf, platformFetch, type StorageConfig } from "@/lib/storage/object-store";
import { STORAGE_PROVIDER } from "@/lib/storage/providers";

import { accountsRuntime } from "./accounts-edge";
import { systemClock } from "./system-clock";

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
function rootKeyOf(env: Env): string {
  if (!env.MEDIA_VAULT_KEY)
    throw new StorageError(STORAGE_CODE.badConfig, "MEDIA_VAULT_KEY is not set (the documents feature is on)");
  return env.MEDIA_VAULT_KEY;
}

/** A key event, until @krizaka/audit is wired (the admin slice): the action, the account's tenant and the numbers, never a key. */
const logKeyEvent = async (note: KeyAuditNote): Promise<void> => {
  console.info(`documents: ${note.action} ${note.target.id} ${JSON.stringify(note.detail)}`);
};

export interface DocumentsRuntime {
  service: DocumentService;
  /** The account of the request's session: the owner of every document it touches. */
  ownerOf(request: Request): Promise<string>;
}

/** Builds the documents feature; refuses when it is off (before anything else: no session is read). The only place that reads the environment for it. */
export function documentsRuntime(env: Env = readEnv()): DocumentsRuntime {
  if (env.MEDIA_STORAGE_ENABLED !== "on") throw new DocumentError(DOCUMENT_ERROR.documentsOff);
  const { sessions } = accountsRuntime(env);
  const { query } = databaseOf(env);
  const service = createDocumentService({
    documents: createDocumentStore(query),
    objects: ownerObjectsOf(objectStoreOf(storageConfigOf(env), { fetch: platformFetch, clock: systemClock }), {
      rootKey: rootKeyOf(env),
      keys: dbTenantKeyStore(query),
      clock: systemClock,
      audit: logKeyEvent,
    }),
    newId: randomUUID,
    limits: SETTINGS.documents,
  });
  return {
    service,
    async ownerOf(request) {
      const session = await sessions.resolve(tokenOfRequest(request.headers));
      if (!session) throw new DocumentError(DOCUMENT_ERROR.unauthenticated);
      return session.account.id;
    },
  };
}

/** A document route, whole: the feature check, then the route's one service call; every refusal is answered in one place. */
export async function documentRoute(
  request: Request,
  work: (runtime: DocumentsRuntime) => Promise<Response>,
): Promise<Response> {
  try {
    return await work(documentsRuntime());
  } catch (error) {
    return documentRefusal(error, request);
  }
}
