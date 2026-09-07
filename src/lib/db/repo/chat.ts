import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export interface ChatMessageRow {
  id: number;
  conversation_id: number;
  document_id: number;
  role: "user" | "assistant";
  content: string;
  source_kind: string;
  source_revision: number;
  quote: string;
  include_notes: 0 | 1;
  ai_config: string | null;
  job_id: number | null;
  status: "ready" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  created_at: string;
}

export function getOrCreateConversation(db: SqliteDb, documentId: number): number {
  const existing = db
    .prepare(`SELECT id FROM chat_conversations WHERE document_id = ?`)
    .get(documentId) as { id: number } | undefined;
  if (existing) return existing.id;
  const ts = nowIso();
  const result = db
    .prepare(
      `INSERT INTO chat_conversations (document_id, created_at, updated_at) VALUES (?, ?, ?)`,
    )
    .run(documentId, ts, ts);
  return Number(result.lastInsertRowid);
}

export function listChatMessages(db: SqliteDb, documentId: number, limit = 100): ChatMessageRow[] {
  const conversation = db
    .prepare(`SELECT id FROM chat_conversations WHERE document_id = ?`)
    .get(documentId) as { id: number } | undefined;
  if (!conversation) return [];
  return db
    .prepare(
      `SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(conversation.id, limit)
    .reverse() as ChatMessageRow[];
}

export function getChatMessage(db: SqliteDb, id: number): ChatMessageRow | null {
  const row = db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id) as
    | ChatMessageRow
    | undefined;
  return row ?? null;
}

export interface InsertUserMessageInput {
  documentId: number;
  content: string;
  sourceKind: string;
  sourceRevision: number;
  quote: string;
  includeNotes: boolean;
  aiConfig: string | null;
  jobId: number;
}

/** Kullanıcı mesajını kaydeder ve kuyruğa düştüğünü işaretler. */
export function insertUserMessage(db: SqliteDb, input: InsertUserMessageInput): ChatMessageRow {
  const conversationId = getOrCreateConversation(db, input.documentId);
  const result = db
    .prepare(
      `INSERT INTO chat_messages
         (conversation_id, document_id, role, content, source_kind, source_revision,
          quote, include_notes, ai_config, job_id, status, created_at)
       VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    )
    .run(
      conversationId,
      input.documentId,
      input.content,
      input.sourceKind,
      input.sourceRevision,
      input.quote,
      input.includeNotes ? 1 : 0,
      input.aiConfig,
      input.jobId,
      nowIso(),
    );
  db.prepare(`UPDATE chat_conversations SET updated_at = ? WHERE id = ?`).run(nowIso(), conversationId);
  return getChatMessage(db, Number(result.lastInsertRowid))!;
}

export function setMessageStatus(db: SqliteDb, id: number, status: ChatMessageRow["status"]): void {
  db.prepare(`UPDATE chat_messages SET status = ? WHERE id = ?`).run(status, id);
}

/** Chat job'ının kullanıcı mesajını bulur (notes_text'e gömülü chatMessageId ile). */
export function findMessageByJob(db: SqliteDb, jobId: number): ChatMessageRow | null {
  const row = db.prepare(`SELECT * FROM chat_messages WHERE job_id = ? AND role = 'user'`).get(jobId) as
    | ChatMessageRow
    | undefined;
  return row ?? null;
}

export function insertAssistantMessage(
  db: SqliteDb,
  conversationId: number,
  documentId: number,
  content: string,
): ChatMessageRow {
  const result = db
    .prepare(
      `INSERT INTO chat_messages
         (conversation_id, document_id, role, content, status, created_at)
       VALUES (?, ?, 'assistant', ?, 'completed', ?)`,
    )
    .run(conversationId, documentId, content, nowIso());
  db.prepare(`UPDATE chat_conversations SET updated_at = ? WHERE id = ?`).run(nowIso(), conversationId);
  return getChatMessage(db, Number(result.lastInsertRowid))!;
}
