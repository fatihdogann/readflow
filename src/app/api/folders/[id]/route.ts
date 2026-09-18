import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { InputError } from "@/lib/types";
import { deleteFolder } from "@/lib/db/repo/folders";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) throw new InputError("Geçersiz klasör kimliği");
    deleteFolder(getDb(), id);
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
