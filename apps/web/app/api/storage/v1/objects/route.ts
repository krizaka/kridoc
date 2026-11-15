import { jsonOf } from "@/lib/auth/http";

import { storageApiRoute } from "../../../../storage-api-edge";

export const dynamic = "force-dynamic";

/** The objects of the client's own tenant under `?prefix=` (all of them without one), in key order, at most the settings' bound. */
export async function GET(request: Request) {
  return storageApiRoute(request, async ({ api, client }) => {
    const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
    return jsonOf(await api.list(client, prefix));
  });
}
