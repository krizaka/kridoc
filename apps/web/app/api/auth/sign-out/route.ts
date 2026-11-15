import { cookies } from "next/headers";

import { accountsRuntime, tokenOfRequest } from "@/app/accounts-edge";
import { jsonOf, refusal } from "@/lib/auth/http";
import { clearedCookieOf } from "@/lib/auth/session-cookie";

export const dynamic = "force-dynamic";

/** Ends the session of the cookie and clears it. Signing out twice is fine. */
export async function POST(request: Request) {
  try {
    const { env, service } = accountsRuntime();
    await service.signOut(tokenOfRequest(request.headers));
    (await cookies()).set(clearedCookieOf(new Date(), env.NODE_ENV));
    return jsonOf({ ok: true });
  } catch (error) {
    return refusal(error, request);
  }
}
