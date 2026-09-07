import type { SqliteDb } from "../db/connection";
import type { JobRow } from "../db/repo/jobs";
import { listChatMessages } from "../db/repo/chat";
import { buildChatPrompt, withChatContextGuard } from "../ai/instructions/chat";

export interface ChatJobContext {
  chatMessageId: number;
  question: string;
  quote: string;
}

export function parseChatJobContext(job: JobRow): ChatJobContext | null {
  try {
    const parsed = JSON.parse(job.notes_text ?? "{}") as Partial<ChatJobContext>;
    if (!parsed.chatMessageId || !parsed.question) return null;
    return {
      chatMessageId: parsed.chatMessageId,
      question: parsed.question,
      quote: parsed.quote ?? "",
    };
  } catch {
    return null;
  }
}

/** Chat job'ının prompt'unu, saklı mesaj ve sınırlı konuşma geçmişinden üretir. */
export function buildChatPromptForJob(db: SqliteDb, job: JobRow): string {
  const context = parseChatJobContext(job);
  if (!context) {
    return buildChatPrompt({
      documentContent: job.source_text,
      question: job.notes_text ?? "Belgeyi özetle",
      history: [],
    });
  }
  const all = listChatMessages(db, job.document_id);
  const history = all
    .filter((message) => message.id < context.chatMessageId && message.status === "completed")
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));
  const guarded = withChatContextGuard(job.source_text);
  return buildChatPrompt({
    documentContent: guarded.content,
    question: context.question,
    history,
    quote: context.quote || undefined,
  });
}
