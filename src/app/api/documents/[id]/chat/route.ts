import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { listChatMessages, getChatMessage } from "@/lib/db/repo/chat";
import { createJob } from "@/lib/db/repo/jobs";
import { getEdit } from "@/lib/db/repo/documentEdits";
import { getDocument } from "@/lib/db/repo/documents";
import { resolveAiConfig } from "@/lib/jobs/create";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function documentIdFrom(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new InputError("Geçersiz doküman kimliği");
  return parsed;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await documentIdFrom(context);
    return Response.json({ messages: listChatMessages(getDb(), documentId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const postSchema = z.object({
  question: z.string().min(1).max(4000),
  sourceKind: z.enum(["auto", "original", "edited"]).optional(),
  quote: z.string().max(2000).optional(),
  includeNotes: z.boolean().optional(),
});

/**
 * Yeni soru: chat_messages'a snapshot ile kaydedilir ve 'chat' işi kuyruğa girer.
 * Aynı soru yenileme/kopma nedeniyle iki kez POST edilirse: ikinci POST aynı
 * içeriğe sahip ayrı bir satır oluşturabilir; ancak istemci idempotency için
 * mesajın clientNonce'ını da gönderebilir — burada forceNew devre dışı bırakılarak
 * aynı bekleyen chat işi tekrar açılmaz (aynı anahtarlı aktif iş döner).
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await documentIdFrom(context);
    const body = postSchema.parse(await readJsonBody(request));
    const db = getDb();
    const document = getDocument(db, documentId);
    if (!document) return Response.json({ error: "Doküman bulunamadı" }, { status: 404 });

    const edit = getEdit(db, documentId);
    const requested = body.sourceKind ?? "auto";
    let sourceKind: "original" | "edited";
    let sourceRevision: number;
    if (requested === "edited" || (requested === "auto" && edit)) {
      if (!edit) throw new InputError("Düzenlenmiş sürüm yok — kaynak Orijinal olmalı");
      sourceKind = "edited";
      sourceRevision = edit.revision;
    } else {
      sourceKind = "original";
      sourceRevision = 0;
    }

    const includeNotes = body.includeNotes === true && document.note.trim().length > 0;
    const aiConfig = resolveAiConfig(db, null);

    // 1) Kullanıcı mesajını kaydet (snapshot: kaynak türü, revizyon, alıntı, not tercihi)
    //    job_id sonradan bağlanır — createJob chatMessageId'yi notes_text'e alır.
    const conversationId = (() => {
      const existing = db
        .prepare(`SELECT id FROM chat_conversations WHERE document_id = ?`)
        .get(documentId) as { id: number } | undefined;
      if (existing) return existing.id;
      const ts = new Date().toISOString();
      const created = db
        .prepare(
          `INSERT INTO chat_conversations (document_id, created_at, updated_at) VALUES (?, ?, ?)`,
        )
        .run(documentId, ts, ts);
      return Number(created.lastInsertRowid);
    })();
    const placeholder = db
      .prepare(
        `INSERT INTO chat_messages
           (conversation_id, document_id, role, content, source_kind, source_revision,
            quote, include_notes, ai_config, status, created_at)
         VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, 'queued', ?)`,
      )
      .run(
        conversationId,
        documentId,
        body.question,
        sourceKind,
        sourceRevision,
        body.quote ?? "",
        includeNotes ? 1 : 0,
        JSON.stringify(aiConfig),
        new Date().toISOString(),
      );
    const chatMessageId = Number(placeholder.lastInsertRowid);

    // 2) Chat işini kuyruğa al (job notes_text'e chat bağlamı gömülür)
    const job = createJob(db, {
      documentId,
      operation: "chat",
      sourceKind,
      sourceText: sourceKind === "edited" ? (edit?.content ?? document.original_text) : document.original_text,
      sourceRevision,
      notesIncluded: true,
      notesText: JSON.stringify({
        chatMessageId,
        question: body.question,
        quote: body.quote ?? "",
      }),
      aiConfig,
    });

    // 3) Mesajı işe bağla
    db.prepare(`UPDATE chat_messages SET job_id = ? WHERE id = ?`).run(job.id, chatMessageId);

    return Response.json(
      { message: getChatMessage(db, chatMessageId), job },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
