import { sessionRoute } from "@/app/accounts-edge";
import { signUpInput } from "@/lib/auth/credentials";

export const dynamic = "force-dynamic";

/** Creates an account and signs it in. Refused with SIGNUP_CLOSED while AUTH_SIGNUP is `closed` (the default); 404 while the feature is off. */
export const POST = (request: Request) =>
  sessionRoute(request, signUpInput, (service, input, caller) => service.signUp(input, caller), 201);
