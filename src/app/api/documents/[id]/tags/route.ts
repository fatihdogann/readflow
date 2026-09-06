import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { setDocumentTags } from "@/lib/db/repo/tags";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const putSchema = z.object({
  tags: z.array(z.string().max(50)).max(20),
});

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const documentId = Number(id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new InputError("Geçersiz doküman kimliği");
    }
    const body = putSchema.parse(await readJsonBody(request));
    const tags = setDocumentTags(getDb(), documentId, body.tags);
    return Response.json({ tags });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
