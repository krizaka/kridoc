import { jsonOf } from "@/lib/auth/http";
import { pageOf } from "@/lib/storage/api-http";

import { storageApiRoute } from "../../../../storage-api-edge";

export const dynamic = "force-dynamic";

/**
 * The objects of the client's own tenant under `?prefix=` (all of them without one), in key order, one page at a time: `?after=` (the last
 * key seen) and `?limit=` (at most the settings' bound); the answer's `next` is the `after` of the next page, `null` on the last.
 */
export async function GET(request: Request) {
  return storageApiRoute(request, async ({ api, client }) => {
    const query = new URL(request.url).searchParams;
    return jsonOf(await api.list(client, query.get("prefix") ?? "", pageOf(query)));
  });
}
