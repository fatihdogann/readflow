import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { getDocument } from "@/lib/db/repo/documents";
import { getEdit } from "@/lib/db/repo/documentEdits";
import { getOutput, getOutputRevision } from "@/lib/db/repo/outputs";
import { buildDocxBuffer } from "@/lib/export/docx";
import { buildPdf } from "@/lib/export/pdf";
import { getRemoteExporter } from "@/lib/export/registry";
import type { ExportPayload } from "@/lib/export/types";
import { slugify } from "@/lib/export/format";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ target: string }> };

const bodySchema = z.object({
  documentId: z.number().int().positive().optional(),
  outputId: z.number().int().positive().optional(),
  /** Belirtilirse o değişmez revizyonun içeriği kullanılır. */
  revisionId: z.number().int().positive().nullable().optional(),
  /** İçerik varyantı etiketi (orijinal/düzenlenmiş/AI çıktısı). */
  variantLabel: z.string().max(40).optional(),
});

function resolvePayload(
  outputId: number | undefined,
  revisionId: number | undefined,
  documentId: number | undefined,
  variantLabel: string | undefined,
): ExportPayload {
  const db = getDb();
  if (outputId) {
    const output = getOutput(db, outputId);
    if (!output) throw new InputError("Çıktı bulunamadı");
    const document = getDocument(db, output.document_id);
    if (!document) throw new InputError("Doküman bulunamadı");
    if (revisionId) {
      const revision = getOutputRevision(db, revisionId);
      if (!revision || revision.output_id !== output.id) throw new InputError("Revizyon bulunamadı");
      return {
        document,
        output: {
          id: output.id,
          document_id: output.document_id,
          operation: revision.operation,
          summary_level: revision.summary_level,
          content: revision.content,
          agent_name: revision.agent_name,
          agent_metadata: revision.agent_metadata,
          created_at: revision.created_at,
          updated_at: revision.created_at,
        },
      };
    }
    return { document, output };
  }
  if (documentId) {
    const document = getDocument(db, documentId);
    if (!document) throw new InputError("Doküman bulunamadı");
    if (variantLabel === "Düzenlenmiş") {
      const edit = getEdit(db, documentId);
      if (!edit) throw new InputError("Düzenlenmiş sürüm yok");
      return { document, output: null, editedContent: edit.content };
    }
    return { document, output: null };
  }
  throw new InputError("outputId veya documentId gerekli");
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { target } = await context.params;
    const body = bodySchema.parse(await readJsonBody(request));
    const payload = resolvePayload(body.outputId, body.revisionId ?? undefined, body.documentId, body.variantLabel);
    const label = body.variantLabel ?? (payload.output ? "AI çıktısı" : "Orijinal");

    if (target === "docx") {
      const buffer = await buildDocxBuffer(payload);
      const suffix = `-${slugify(label)}`;
      const filename = `${slugify(payload.document.title)}${suffix}.docx`;
      return new Response(new Uint8Array(buffer), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }
    if (target === "pdf") {
      try {
        const bytes = await buildPdf(payload, label);
        const filename = `${slugify(payload.document.title)}-${slugify(label)}.pdf`;
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${filename}"`,
          },
        });
      } catch (pdfError) {
        console.error("[export/pdf]", pdfError);
        return Response.json(
          { ok: false, message: "PDF oluşturulamadı — içerik çok uzun olabilir; tekrar dene." },
          { status: 500 },
        );
      }
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
