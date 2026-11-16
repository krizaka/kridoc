import { jsonOf } from "@/lib/auth/http";

import { storageApiRoute } from "../../../../storage-api-edge";

export const dynamic = "force-dynamic";

/** What the client's tenant keeps (bytes, objects) and what it may keep (the quota of the storage settings). Needs the `get` scope. */
export async function GET(request: Request) {
  return storageApiRoute(request, async ({ api, client }) => jsonOf(await api.usage(client)));
}
