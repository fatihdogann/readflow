import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createAnnotation, listAnnotations } from "@/lib/db/repo/annotations";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const createSchema = z.object({
  contentKind: z.enum(["original", "edited"]),
  contentRevision: z.number().int().min(0),
  quote: z.string().min(1).max(2000),
  prefix: z.string().max(200).optional(),
  suffix: z.string().max(200).optional(),
  color: z.enum(["yellow", "green", "lavender"]),
  note: z.string().max(5000).optional(),
});

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const documentId = Number(id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new InputError("Geçersiz doküman kimliği");
    }
    return Response.json({ annotations: listAnnotations(getDb(), documentId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const documentId = Number(id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new InputError("Geçersiz doküman kimliği");
    }
    const body = createSchema.parse(await readJsonBody(request));
    const annotation = createAnnotation(getDb(), {
      documentId,
      contentKind: body.contentKind,
      contentRevision: body.contentRevision,
      quote: body.quote,
      prefix: body.prefix,
      suffix: body.suffix,
      color: body.color,
      note: body.note,
    });
    return Response.json({ annotation }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
