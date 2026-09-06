import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { deleteDocument, setFavorite, setFolder, setTitle } from "@/lib/db/repo/documents";
import { getDocumentDetail } from "@/lib/documents/service";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function parseId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InputError("Geçersiz doküman kimliği");
  }
  return parsed;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await parseId(context);
    const detail = getDocumentDetail(getDb(), id);
    if (!detail) return Response.json({ error: "Doküman bulunamadı" }, { status: 404 });
    return Response.json(detail);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const patchSchema = z.object({
  favorite: z.boolean().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(300).optional(),
});

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await parseId(context);
    const body = patchSchema.parse(await readJsonBody(request));
    const db = getDb();
    if (body.favorite !== undefined) setFavorite(db, id, body.favorite);
    if (body.folderId !== undefined) setFolder(db, id, body.folderId);
    if (body.title !== undefined) setTitle(db, id, body.title.trim());
    const detail = getDocumentDetail(db, id);
    if (!detail) return Response.json({ error: "Doküman bulunamadı" }, { status: 404 });
    return Response.json(detail);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await parseId(context);
    deleteDocument(getDb(), id);
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
