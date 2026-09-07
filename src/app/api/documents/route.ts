import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createDocumentFromInput, type CreateDocumentInput } from "@/lib/documents/service";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

/** PDF/Word yükleme sınırı; HTML gövdelerinden çok daha büyük olabilirler. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_HTML_CHARS = 5_000_000;

const createSchema = z
  .object({
    url: z.string().optional(),
    text: z.string().optional(),
    html: z.string().max(MAX_HTML_CHARS).optional(),
    sourceUrl: z.string().max(2000).optional(),
    title: z.string().max(300).optional(),
    folderId: z.number().int().positive().nullable().optional(),
  })
  .refine((body) => Boolean(body.url?.trim() || body.text?.trim() || body.html?.trim()), {
    message: "Bir bağlantı, metin veya sayfa kaynağı gerekli",
  });

/** multipart/form-data: dosya yükleme (PDF, .docx, .md, .txt). */
async function inputFromFormData(request: Request): Promise<CreateDocumentInput> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new InputError("Dosya bulunamadı");
  if (file.size === 0) throw new InputError("Dosya boş");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new InputError(`Dosya çok büyük (sınır: ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
  }
  const folderRaw = form.get("folderId");
  const folderId = typeof folderRaw === "string" && folderRaw.trim() ? Number(folderRaw) : null;
  return {
    file: {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      contentType: file.type,
    },
    title: typeof form.get("title") === "string" ? String(form.get("title")) : undefined,
    folderId: Number.isInteger(folderId) && folderId! > 0 ? folderId : null,
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const input = contentType.includes("multipart/form-data")
      ? await inputFromFormData(request)
      : createSchema.parse(await readJsonBody(request));

    const document = await createDocumentFromInput(getDb(), input);
    return Response.json({ id: document.id, title: document.title }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
