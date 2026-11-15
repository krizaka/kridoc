import { AUTH_ERROR, AuthError } from "@/lib/auth/errors";
import { tokenOfRequest } from "@/lib/auth/session-cookie";
import { type Env, readEnv } from "@/lib/env";
import { adminRefusal } from "@/lib/storage/admin-http";
import {
  type AdminActor,
  createStorageSettingsAdmin,
  type StorageSettingsAdmin,
} from "@/lib/storage/storage-settings-admin";

import { accountsRuntime } from "./accounts-edge";
import { storageSettingsOf, storageTrailOf } from "./storage-rules-edge";
import { systemClock } from "./system-clock";

export interface StorageAdminRuntime {
  admin: StorageSettingsAdmin;
  /** The account behind the request's session cookie. @throws AuthError `UNAUTHENTICATED` */
  actorOf(headers: Headers): Promise<AdminActor>;
}

/** Builds the storage admin; refuses when the accounts are off (before anything else: no session is read). The only place that reads the environment for it. */
export function storageAdminRuntime(env: Env = readEnv()): StorageAdminRuntime {
  const { sessions } = accountsRuntime(env);
  const trail = storageTrailOf(env);
  return {
    admin: createStorageSettingsAdmin({
      settings: storageSettingsOf(env),
      record: trail.record,
      list: trail.list,
      clock: systemClock,
    }),
    async actorOf(headers) {
      const session = await sessions.resolve(tokenOfRequest(headers));
      if (!session) throw new AuthError(AUTH_ERROR.unauthenticated);
      return { id: session.account.id, label: session.account.email, role: session.account.role };
    },
  };
}

/** An admin route, whole: the feature check, the session, then the route's one service call; every refusal is answered in one place. */
export async function storageAdminRoute(
  request: Request,
  work: (runtime: StorageAdminRuntime & { actor: AdminActor }) => Promise<Response>,
): Promise<Response> {
  try {
    const runtime = storageAdminRuntime();
    return await work({ ...runtime, actor: await runtime.actorOf(request.headers) });
  } catch (error) {
    return adminRefusal(error, request);
  }
}
