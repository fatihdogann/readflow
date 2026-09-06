import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { getDocument } from "@/lib/db/repo/documents";
import { getOutput } from "@/lib/db/repo/outputs";
import { buildDocxBuffer } from "@/lib/export/docx";
import { getRemoteExporter } from "@/lib/export/registry";
import type { ExportPayload } from "@/lib/export/types";
import { slugify } from "@/lib/export/format";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ target: string }> };

const bodySchema = z.object({
  outputId: z.number().int().positive().optional(),
});

async function loadPayload(
  outputId: number | undefined,
): Promise<ExportPayload> {
  const db = getDb();
  if (!outputId) {
    throw new InputError("outputId gerekli (doküman kimliği ile çıktı seçilmeli)");
  }
  const output = getOutput(db, outputId);
  if (!output) throw new InputError("Çıktı bulunamadı");
  const document = getDocument(db, output.document_id);
  if (!document) throw new InputError("Doküman bulunamadı");
  return { document, output };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { target } = await context.params;
    const body = bodySchema.parse(await readJsonBody(request));
    const payload = await loadPayload(body.outputId);

    if (target === "docx") {
      const buffer = await buildDocxBuffer(payload);
      const filename = `${slugify(payload.document.title)}.docx`;
      return new Response(new Uint8Array(buffer), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const exporter = getRemoteExporter(target);
    if (!exporter) {
      return Response.json(
        { ok: false, message: `Bilinmeyen dışa aktarma hedefi: ${target}` },
        { status: 404 },
      );
    }
    const result = await exporter.export(payload);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
