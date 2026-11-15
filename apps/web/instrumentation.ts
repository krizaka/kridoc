import { assertProductionEnv } from "@/lib/env";

/** Next runs this once when the server starts: a production server with a missing setting stops here, with the names. */
export function register() {
  assertProductionEnv();
}
