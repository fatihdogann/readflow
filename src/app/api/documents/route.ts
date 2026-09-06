import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createDocumentFromInput } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    url: z.string().optional(),
    text: z.string().optional(),
    title: z.string().max(300).optional(),
    folderId: z.number().int().positive().nullable().optional(),
  })
  .refine((body) => Boolean(body.url?.trim() || body.text?.trim()), {
    message: "Bir bağlantı veya metin gerekli",
  });

export async function POST(request: Request): Promise<Response> {
  try {
    const body = createSchema.parse(await readJsonBody(request));
    const document = await createDocumentFromInput(getDb(), body);
    return Response.json({ id: document.id, title: document.title }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
