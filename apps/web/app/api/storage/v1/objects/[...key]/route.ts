import { jsonOf } from "@/lib/auth/http";
import { boundedBody, headResponse, keyOfSegments, objectResponse } from "@/lib/storage/api-http";
import { declaredSha256, reprDigestOf } from "@/lib/storage/object-digest";

import { storageApiRoute } from "../../../../../storage-api-edge";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ key: string[] }>;
}

const keyOf = async ({ params }: Params) => keyOfSegments((await params).key);

/**
 * Keeps an object under the client's own tenant (the raw body, its `Content-Type`); an existing key is replaced, unless `If-None-Match: *`
 * (create-only: the same bytes answer 200 + `Idempotent-Replayed: true`, others 412). `Repr-Digest` (RFC 9530) is checked against the bytes.
 */
export async function PUT(request: Request, params: Params) {
  return storageApiRoute(request, async ({ api, client, rules }) => {
    const bytes = await boundedBody(request, (await rules()).maxBytes);
    const type = request.headers.get("content-type") ?? "";
    const sha256 = declaredSha256(request.headers.get("repr-digest"));
    const createOnly = request.headers.get("if-none-match")?.trim() === "*";
    const { replayed, ...object } = await api.put(client, await keyOf(params), bytes, type, { sha256, createOnly });
    const headers = {
      "Repr-Digest": reprDigestOf(object.sha256),
      ...(replayed ? { "Idempotent-Replayed": "true" } : {}),
    };
    return jsonOf({ object }, { status: replayed ? 200 : 201, headers });
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
  return storageApiRoute(request, async ({ api, client }) => headResponse(await api.head(client, await keyOf(params))));
}

/** Deletes an object of the client's own tenant and answers its deletion record; a missing one is `{ key, absent: true }`, not an error. */
export async function DELETE(request: Request, params: Params) {
  return storageApiRoute(request, async ({ api, client }) => {
    const record = await api.remove(client, await keyOf(params));
    return jsonOf(record);
  });
}
