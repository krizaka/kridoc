import { documentRoute } from "@/app/documents-edge";
import { downloadOf } from "@/lib/storage/http";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** The bytes of one of the signed-in person's documents, as an attachment. Another person's document is « not found ». */
export async function GET(request: Request, { params }: Params) {
  return documentRoute(request, async ({ service, ownerOf }) => {
    const { record, bytes } = await service.read(await ownerOf(request), (await params).id);
    return downloadOf(bytes, record.mediaType, record.title);
  });
}

/** Deletes one of the signed-in person's documents: its metadata, then its bytes. */
export async function DELETE(request: Request, { params }: Params) {
  return documentRoute(request, async ({ service, ownerOf }) => {
    await service.remove(await ownerOf(request), (await params).id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  });
}
