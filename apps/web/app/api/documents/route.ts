import { readUpload } from "@krizaka/storage";

import { documentRoute } from "@/app/documents-edge";
import { jsonOf } from "@/lib/auth/http";
import { SETTINGS } from "@/lib/env";
import { documentView } from "@/lib/storage/document-service";

export const dynamic = "force-dynamic";

/** The signed-in person's documents, newest first. */
export async function GET(request: Request) {
  return documentRoute(request, async ({ service, ownerOf }) => {
    const documents = await service.list(await ownerOf(request));
    return jsonOf({ documents: documents.map(documentView) });
  });
}

/** Keeps one document (multipart: `file`, and an optional `title`). The session is checked before the body is read. */
export async function POST(request: Request) {
  return documentRoute(request, async ({ service, ownerOf }) => {
    const owner = await ownerOf(request);
    const upload = await readUpload(request, { field: "file", maxBytes: SETTINGS.documents.maxBytes });
    const title = upload.form.get("title");
    const record = await service.upload(owner, {
      bytes: upload.bytes,
      name: upload.name,
      ...(typeof title === "string" ? { title } : {}),
    });
    return jsonOf({ document: documentView(record) }, { status: 201 });
  });
}
