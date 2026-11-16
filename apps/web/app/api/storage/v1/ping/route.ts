import { jsonOf } from "@/lib/auth/http";

import { storageApiRoute } from "../../../../storage-api-edge";

export const dynamic = "force-dynamic";

/** Who the token is: its tenant, its scopes, when its key expires (`null`: it does not) and the API's version. Any client may ask. */
export async function GET(request: Request) {
  return storageApiRoute(request, async ({ api, client }) => jsonOf(api.ping(client)));
}
