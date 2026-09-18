import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { InputError } from "@/lib/types";
import { updateNote } from "@/lib/db/repo/notes";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(20_000).optional(),
  folderId: z.number().int().positive().nullable().optional(),
});

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) throw new InputError("Geçersiz not kimliği");
    const note = updateNote(getDb(), id, patchSchema.parse(await readJsonBody(request)));
    if (!note) return Response.json({ error: "Not bulunamadı" }, { status: 404 });
    return Response.json({ note });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
