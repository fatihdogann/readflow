import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { InputError } from "@/lib/types";
import { setNoteTags } from "@/lib/db/repo/notes";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const putSchema = z.object({ tags: z.array(z.string().max(50)).max(20) });

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) throw new InputError("Geçersiz not kimliği");
    const note = setNoteTags(getDb(), id, putSchema.parse(await readJsonBody(request)).tags);
    if (!note) return Response.json({ error: "Not bulunamadı" }, { status: 404 });
    return Response.json({ note });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
