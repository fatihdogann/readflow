import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { deleteAnnotation, updateAnnotation } from "@/lib/db/repo/annotations";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  note: z.string().max(5000).optional(),
  color: z.enum(["yellow", "green", "lavender"]).optional(),
});

async function idFrom(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new InputError("Geçersiz vurgu kimliği");
  return parsed;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await idFrom(context);
    const body = patchSchema.parse(await readJsonBody(request));
    const annotation = updateAnnotation(getDb(), id, body);
    if (!annotation) return Response.json({ error: "Vurgu bulunamadı" }, { status: 404 });
    return Response.json({ annotation });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await idFrom(context);
    return Response.json({ ok: deleteAnnotation(getDb(), id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
