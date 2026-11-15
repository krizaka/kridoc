import { clientIp, decoyHash, hashPassword, verifyPassword } from "@krizaka/auth";
import { createLimiter, memoryLimitStore } from "@krizaka/rate-limit";
import { cookies } from "next/headers";
import type { ZodType } from "zod";

import { createAccountSessions } from "@/lib/auth/account-sessions";
import { createAccountStore } from "@/lib/auth/account-store";
import { type AuthService, type Caller, createAuthService, type OpenedSession } from "@/lib/auth/auth-service";
import { parseInput } from "@/lib/auth/credentials";
import { AUTH_ERROR, AuthError } from "@/lib/auth/errors";
import { jsonBody, jsonOf, refusal } from "@/lib/auth/http";
import { sessionCookieOf } from "@/lib/auth/session-cookie";
import { databaseOf } from "@/lib/db/connection";
import { type Env, readEnv, SETTINGS } from "@/lib/env";

import { systemClock } from "./system-clock";

/** The limiter lives as long as the process: its counters are this instance's (a shared store is a follow-up when there are several). */
const limiter = createLimiter({
  store: memoryLimitStore(),
  clock: systemClock,
  limits: { signIn: { ...SETTINGS.signIn }, signUp: { ...SETTINGS.signUp } },
  onStoreError: (_error, action) => console.error(`accounts: the limiter failed on ${action}`),
});

/** Builds the accounts feature on the process's pool; refuses when the feature is off. The only place that reads the environment for it. */
export function accountsRuntime(env: Env = readEnv()) {
  if (env.AUTH_ENABLED !== "on") throw new AuthError(AUTH_ERROR.accountsOff);
  const { query } = databaseOf(env);
  const sessions = createAccountSessions({
    query,
    clock: systemClock,
    secret: () => env.AUTH_SESSION_SECRET ?? "",
    sessionDays: SETTINGS.sessionDays,
  });
  const service = createAuthService({
    accounts: createAccountStore(query),
    limiter,
    hash: hashPassword,
    verify: verifyPassword,
    decoy: decoyHash,
    openSession: (accountId, caller) => sessions.create(accountId, caller),
    closeSession: (token) => sessions.revoke(token),
    signupOpen: env.AUTH_SIGNUP === "open",
    maxFailedSignIns: SETTINGS.maxFailedSignIns,
  });
  return { env, service, sessions };
}

/** The caller of a request: the address as far as the deployment can trust it, and the browser's name. */
export const callerOf = (headers: Headers, env: Env): Caller => ({
  ip: clientIp(headers, { header: env.ABUSE_CLIENT_IP_HEADER, trustedProxyHops: env.ABUSE_TRUSTED_PROXY_HOPS }),
  userAgent: headers.get("user-agent"),
});

/** A sign-in or a sign-up route, whole: the feature check, the body parsed at the edge, the one service call, the session cookie and the answer. */
export async function sessionRoute<T>(
  request: Request,
  schema: ZodType<T>,
  open: (service: AuthService, input: T, caller: Caller) => Promise<OpenedSession>,
  status: number,
): Promise<Response> {
  try {
    const { env, service } = accountsRuntime();
    const input = parseInput(schema, await jsonBody(request));
    const { account, token, expires } = await open(service, input, callerOf(request.headers, env));
    (await cookies()).set(sessionCookieOf(token, expires, env.NODE_ENV));
    return jsonOf({ account: { email: account.email, locale: account.locale } }, { status });
  } catch (error) {
    return refusal(error, request);
  }
}
