import { sessionRoute } from "@/app/accounts-edge";
import { signInInput } from "@/lib/auth/credentials";

export const dynamic = "force-dynamic";

/** E-mail and password → a session cookie. Answers 404 while the accounts feature is off. */
export const POST = (request: Request) =>
  sessionRoute(request, signInInput, (service, input, caller) => service.signIn(input, caller), 200);
