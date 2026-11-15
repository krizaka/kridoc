import { productionProblems, readEnv } from "@/lib/env";
import { APP_VERSION } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Readiness for App Platform and for the apps that call Kridoc: 200 when the environment is complete, 503 naming what is missing.
 * The problems are names, never values. (The database round trip joins here with the database client, #3714.)
 */
export function GET() {
  const problems = productionProblems(readEnv());
  return Response.json(
    { status: problems.length ? "unavailable" : "ok", version: APP_VERSION, problems },
    { status: problems.length ? 503 : 200 },
  );
}
