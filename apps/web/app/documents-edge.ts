import { randomUUID } from "node:crypto";

import { dbTenantKeyStore } from "@krizaka/storage";

import { tokenOfRequest } from "@/lib/auth/session-cookie";
import { databaseOf } from "@/lib/db/connection";
import { createDocumentStore } from "@/lib/db/document-store";
import { type Env, readEnv } from "@/lib/env";
import { documentScannerOf } from "@/lib/storage/document-scanner";
import { createDocumentService, type DocumentService } from "@/lib/storage/document-service";
import { ownerObjectsOf } from "@/lib/storage/document-vault";
import { DOCUMENT_ERROR, DocumentError } from "@/lib/storage/errors";
import { documentRefusal } from "@/lib/storage/http";
import { objectStoreOf, platformFetch, quarantineStoreOf } from "@/lib/storage/object-store";
import type { StorageRulesSource } from "@/lib/storage/storage-settings";

import { accountsRuntime } from "./accounts-edge";
import { logKeyEvent, storageConfigOf, vaultRootKeyOf } from "./storage-edge";
import { storageRulesFor, storageTrailOf } from "./storage-rules-edge";
import { systemClock } from "./system-clock";

export interface DocumentsRuntime {
  service: DocumentService;
  /** The administrator's rules, asked by the route for the size it reads (the service asks again for the types). */
  rules: StorageRulesSource;
  /** The account of the request's session: the owner of every document it touches. */
  ownerOf(request: Request): Promise<string>;
}

/** Builds the documents feature; refuses when it is off (before anything else: no session is read). The only place that reads the environment for it. */
export function documentsRuntime(env: Env = readEnv()): DocumentsRuntime {
  if (env.MEDIA_STORAGE_ENABLED !== "on") throw new DocumentError(DOCUMENT_ERROR.documentsOff);
  const { sessions } = accountsRuntime(env);
  const { query } = databaseOf(env);
  const rules = storageRulesFor(env);
  const storage = storageConfigOf(env);
  const adapters = { fetch: platformFetch, clock: systemClock };
  const quarantine = quarantineStoreOf(storage, adapters);
  const service = createDocumentService({
    documents: createDocumentStore(query),
    quarantine,
    scanner: documentScannerOf({ host: env.MEDIA_SCAN_CLAMD_HOST, port: env.MEDIA_SCAN_CLAMD_PORT }, quarantine),
    objects: ownerObjectsOf(objectStoreOf(storage, adapters), {
      rootKey: vaultRootKeyOf(env),
      keys: dbTenantKeyStore(query),
      clock: systemClock,
      audit: logKeyEvent,
    }),
    newId: randomUUID,
    rules,
    audit: storageTrailOf(env).audit,
  });
  return {
    service,
    rules,
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
