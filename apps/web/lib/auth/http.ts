import { RateLimited } from "@krizaka/rate-limit";

import { getDictionary } from "@/lib/i18n";
import { preferredLocale } from "@/lib/locale";

import { AUTH_ERROR, AUTH_STATUS, AuthError, type AuthErrorCode } from "./errors";

/** The cookie that remembers a visitor's language (see proxy.ts). */
const LOCALE_COOKIE = "NEXT_LOCALE";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function jsonOf(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: { ...NO_STORE, ...init.headers } });
}

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** The error of an exception: the typed refusals and the limiter's are answered as they are, anything else is an `INTERNAL`. */
function codeOf(error: unknown): AuthErrorCode {
  if (error instanceof AuthError) return error.code;
  if (error instanceof RateLimited) return AUTH_ERROR.rateLimited;
  return AUTH_ERROR.internal;
}

/** The one place a refusal becomes an HTTP answer: status from the code, words from the catalogue in the visitor's language, `Retry-After` when limited. */
export function refusal(error: unknown, request: Request): Response {
  const code = codeOf(error);
  // Only the kind of failure is logged: never a message (a driver's can carry a value), a body or a header.
  if (code === AUTH_ERROR.internal)
    console.error(`accounts: unexpected failure (${error instanceof Error ? error.name : typeof error})`);
  const locale = preferredLocale(cookieValue(request, LOCALE_COOKIE), request.headers.get("accept-language"));
  const message = getDictionary(locale).auth.errors[code];
  const headers = error instanceof RateLimited ? error.headers : {};
  const status = AUTH_STATUS[code];
  // Problem Details (RFC 9457): what `krizakaFetch` of @krizaka/query reads; `code` is the stable slug, `detail` the words.
  return jsonOf(
    { type: "about:blank", title: code, status, code, detail: message },
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

/** A route's body, read as JSON; anything else is `INVALID_INPUT`. */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AuthError(AUTH_ERROR.invalidInput);
  }
}
