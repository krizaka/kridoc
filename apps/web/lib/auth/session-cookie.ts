import { clearedSessionCookie, sessionCookie, sessionTokenOf } from "@krizaka/auth";

/** The name of Kridoc's own session cookie (HttpOnly, SameSite=Lax; `Secure` in production). */
export const SESSION_COOKIE = "kridoc_session";

const secure = (nodeEnv: string | undefined): boolean => nodeEnv === "production";

export const sessionCookieOf = (token: string, expires: Date, nodeEnv: string | undefined) =>
  sessionCookie(token, expires, { name: SESSION_COOKIE, secure: secure(nodeEnv) });

export const clearedCookieOf = (now: Date, nodeEnv: string | undefined) =>
  clearedSessionCookie({ name: SESSION_COOKIE, secure: secure(nodeEnv) }, now);

/** The raw token of a request: this site's cookie only (no native app, so no bearer). */
export const tokenOfRequest = (headers: Headers): string | undefined =>
  sessionTokenOf(headers, { cookie: SESSION_COOKIE, bearer: false });
