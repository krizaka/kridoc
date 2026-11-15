import { z } from "zod";

import { jsonOf } from "@/lib/auth/http";
import { STORAGE_API_ERROR, StorageApiError } from "@/lib/storage/api-errors";
import { keyOfSegments, objectResponse } from "@/lib/storage/api-http";

import { linkUrlOf, storageApiRoute, storageLinkRoute } from "../../../../../storage-api-edge";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ key: string[] }>;
}

const keyOf = async ({ params }: Params) => keyOfSegments((await params).key);

const signSchema = z.object({ ttlSeconds: z.number().int().min(1).optional() }).strict();

/** The body of a signing request: none, or `{ "ttlSeconds": n }` (capped by the settings). */
async function ttlOf(request: Request): Promise<number | undefined> {
  const text = (await request.text()).trim();
  let body: unknown = {};
  try {
    if (text !== "") body = JSON.parse(text);
  } catch {
    throw new StorageApiError(STORAGE_API_ERROR.invalidInput);
  }
  const parsed = signSchema.safeParse(body);
  if (!parsed.success) throw new StorageApiError(STORAGE_API_ERROR.invalidInput);
  return parsed.data.ttlSeconds;
}

/** A link to an object of the client's own tenant, for a browser or a worker without the token; it lives a few minutes. */
export async function POST(request: Request, params: Params) {
  return storageApiRoute(request, async ({ api, client, env }) => {
    const link = await api.sign(client, await keyOf(params), await ttlOf(request));
    return jsonOf(
      { url: linkUrlOf(env.APP_PUBLIC_URL, link.query), expiresAt: link.expiresAt.toISOString() },
      { status: 201 },
    );
  });
}

/** The object a signed link names, while the link lives and its client is not revoked. */
export async function GET(request: Request, params: Params) {
  return storageLinkRoute(request, async ({ api }) => {
    const search = new URL(request.url).searchParams;
    const object = await api.readLink({
      key: await keyOf(params),
      client: search.get("client") ?? "",
      expires: search.get("expires") ?? "",
      signature: search.get("signature") ?? "",
    });
    return objectResponse(object);
  });
}
