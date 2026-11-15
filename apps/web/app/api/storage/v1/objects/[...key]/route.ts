import { jsonOf } from "@/lib/auth/http";
import { boundedBody, headResponse, keyOfSegments, objectResponse } from "@/lib/storage/api-http";

import { storageApiRoute } from "../../../../../storage-api-edge";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ key: string[] }>;
}

const keyOf = async ({ params }: Params) => keyOfSegments((await params).key);

/** Keeps an object under the client's own tenant (the raw body, its `Content-Type`); an existing key is replaced. */
export async function PUT(request: Request, params: Params) {
  return storageApiRoute(request, async ({ api, client, rules }) => {
    const bytes = await boundedBody(request, (await rules()).maxBytes);
    const type = request.headers.get("content-type") ?? "";
    const stored = await api.put(client, await keyOf(params), bytes, type);
    return jsonOf({ object: stored }, { status: 201 });
  });
}

/** An object of the client's own tenant, as an attachment. Another tenant's is « not found »: it cannot even be named. */
export async function GET(request: Request, params: Params) {
  return storageApiRoute(request, async ({ api, client }) =>
    objectResponse(await api.get(client, await keyOf(params))),
  );
}

/** The size of an object of the client's own tenant, without its bytes. */
export async function HEAD(request: Request, params: Params) {
  return storageApiRoute(request, async ({ api, client }) =>
    headResponse((await api.head(client, await keyOf(params))).size),
  );
}

/** Deletes an object of the client's own tenant; deleting a missing one is not an error. */
export async function DELETE(request: Request, params: Params) {
  return storageApiRoute(request, async ({ api, client }) => {
    await api.remove(client, await keyOf(params));
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  });
}
