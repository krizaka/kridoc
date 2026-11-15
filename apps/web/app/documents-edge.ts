import { randomUUID } from "node:crypto";

import { dbTenantKeyStore } from "@krizaka/storage";

import { tokenOfRequest } from "@/lib/auth/session-cookie";
import { databaseOf } from "@/lib/db/connection";
import { createDocumentStore } from "@/lib/db/document-store";
import { type Env, readEnv, SETTINGS } from "@/lib/env";
import { createDocumentService, type DocumentService } from "@/lib/storage/document-service";
import { ownerObjectsOf } from "@/lib/storage/document-vault";
import { DOCUMENT_ERROR, DocumentError } from "@/lib/storage/errors";
import { documentRefusal } from "@/lib/storage/http";
import { objectStoreOf, platformFetch } from "@/lib/storage/object-store";

import { accountsRuntime } from "./accounts-edge";
import { logKeyEvent, storageConfigOf, vaultRootKeyOf } from "./storage-edge";
import { systemClock } from "./system-clock";

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
      rootKey: vaultRootKeyOf(env),
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
