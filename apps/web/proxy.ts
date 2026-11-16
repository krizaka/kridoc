import { type NextRequest, NextResponse } from "next/server";

import { devRedirect, isDevHost } from "@/lib/dev-host";
import { LOCALES } from "@/lib/i18n";
import { preferredLocale } from "@/lib/locale";
import { SITE_URL } from "@/lib/site";

/** The dev host sends its pages to www (308); an address without a language gets one (lib/locale.ts: French unless asked otherwise). */
export function proxy(request: NextRequest) {
  const response = routed(request);
  if (isDevHost(request.headers.get("host"))) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function routed(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const to = devRedirect(request.headers.get("host"), pathname, search, SITE_URL, process.env.APP_DEV_HOST);
  if (to) return NextResponse.redirect(to, 308);
  if (
    pathname.startsWith("/api") ||
    pathname === "/robots.txt" ||
    LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))
  )
    return NextResponse.next();
  const locale = preferredLocale(request.cookies.get("NEXT_LOCALE")?.value, request.headers.get("accept-language"));
  return NextResponse.redirect(new URL(`/${locale}${pathname === "/" ? "" : pathname}`, request.url));
}

// Only pages without a file extension reach the proxy. The matcher must stay a plain string literal
// (Next reads it statically at build: a String.raw template fails the build), hence the doubled backslash.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"], // NOSONAR
};
