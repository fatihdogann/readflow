import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { deleteEdit, getEdit, saveEdit } from "@/lib/db/repo/documentEdits";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function parseId(context: RouteContext): Promise<number> {
  return context.params.then(({ id }) => {
    const parsed = Number(id);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new InputError("Geçersiz doküman kimliği");
    }
    return parsed;
  });
}

const putSchema = z.object({
  content: z.string().max(500_000),
  /** Optimistic concurrency: uyuşmazsa 409 döner, istemci taslağını korur. */
  revision: z.number().int().min(0).nullable(),
});

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await parseId(context);
    const body = putSchema.parse(await readJsonBody(request));
    const outcome = saveEdit(getDb(), id, body.content, body.revision);
    if (!outcome.applied) {
      return Response.json(
        {
          error: "Sürüm çakışması: belge başka bir kayıtla güncellenmiş",
          currentRevision: outcome.edit.revision,
          currentContent: outcome.edit.content,
        },
        { status: 409 },
      );
    }
    return Response.json({
      edit: {
        content: outcome.edit.content,
        revision: outcome.edit.revision,
        created_at: outcome.edit.created_at,
        updated_at: outcome.edit.updated_at,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await parseId(context);
    const removed = deleteEdit(getDb(), id);
    return Response.json({ ok: true, removed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await parseId(context);
    const edit = getEdit(getDb(), id);
    return Response.json({ edit });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
