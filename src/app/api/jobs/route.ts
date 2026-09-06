import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createJob, listJobsByDocument } from "@/lib/db/repo/jobs";
import { getDocumentDetail } from "@/lib/documents/service";
import { InputError, operationSchema, storedLevel, summaryLevelSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    documentId: z.number().int().positive(),
    operation: operationSchema,
    summaryLevel: summaryLevelSchema.optional(),
  })
  .refine((body) => body.operation !== "summary" || body.summaryLevel !== undefined, {
    message: "Özet operasyonu için seviye gerekli",
  });

export async function POST(request: Request): Promise<Response> {
  try {
    const body = createSchema.parse(await readJsonBody(request));
    const db = getDb();
    const detail = getDocumentDetail(db, body.documentId);
    if (!detail) return Response.json({ error: "Doküman bulunamadı" }, { status: 404 });

    const job = createJob(db, {
      documentId: body.documentId,
      operation: body.operation,
      summaryLevel: storedLevel(body.summaryLevel),
    });
    return Response.json({ job }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const documentId = Number(url.searchParams.get("documentId"));
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new InputError("documentId gerekli");
    }
    return Response.json({ jobs: listJobsByDocument(getDb(), documentId, 10) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
