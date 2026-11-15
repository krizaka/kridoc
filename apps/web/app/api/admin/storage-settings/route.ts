import { z } from "zod";

import { storageAdminRoute } from "@/app/storage-admin-edge";
import { jsonBody, jsonOf } from "@/lib/auth/http";
import { STORAGE_ADMIN_ERROR, StorageAdminError } from "@/lib/storage/admin-errors";

export const dynamic = "force-dynamic";

const body = z.object({ changes: z.record(z.string(), z.unknown()) });

/** The storage settings with their values, defaults and bounds: an administrator only. */
export async function GET(request: Request) {
  return storageAdminRoute(request, async ({ admin, actor }) => jsonOf({ settings: await admin.current(actor) }));
}

/** Changes some of them within their bounds (`{ changes: { "storage.maxMb": 10 } }`): whole or not at all, one audit line per changed value. */
export async function PUT(request: Request) {
  return storageAdminRoute(request, async ({ admin, actor }) => {
    const parsed = body.safeParse(await jsonBody(request));
    if (!parsed.success) throw new StorageAdminError(STORAGE_ADMIN_ERROR.invalid);
    return jsonOf({ settings: await admin.change(actor, parsed.data.changes) });
  });
}
