function normalizeSpacing(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatPromptInput {
  documentContent: string;
  question: string;
  history: ChatHistoryItem[];
  quote?: string;
  includeNotes?: boolean;
  noteText?: string;
}

/** Sohbet cevabı yalnızca belge metnine dayanır; olmayan bilgi uydurulmaz. */
export function buildChatPrompt(input: ChatPromptInput): string {
  const history = input.history
    .slice(-8)
    .map((item) => `${item.role === "user" ? "Kullanıcı" : "Asistan"}: ${item.content}`)
    .join("\n\n");
  const quoteBlock = input.quote?.trim()
    ? `\n\nKullanıcının soru sorduğu ALINTI:\n"""\n${input.quote.trim()}\n"""`
    : "";
  const notesBlock =
    input.includeNotes && input.noteText?.trim()
      ? `\n\nKullanıcının belge notu (bağlam):\n${input.noteText.trim()}`
      : "";

  return `Sen bir okuma asistanısın. Aşağıda kullanıcının okuduğu belge metni ve o belgeyle ilgili bir soru verilecek.

[GÖREV: BELGE SORUSU]

KURALLAR:
1. Yalnızca verilen belge metnine ve konuşma geçmişine dayanarak cevap ver.
2. Cevap belge metninde yoksa bunu AÇIKÇA söyle: "Bu bilgi belge metninde yer almıyor." Tahmin etme, kaynak uydurma.
3. Mümkün olduğunda cevabında belgeden kısa alıntı ver veya hangi bölümle ilgili olduğunu belirt.
4. Belge metninin dilinde cevap ver (Türkçe belgeye Türkçe cevap).
5. Yalnızca Markdown döndür; önsöz ve yorum yok.

=== BELGE METNİ ===
${input.documentContent}
=== BELGE METNİ SONU ===${quoteBlock}${notesBlock}
${history ? `\n=== ÖNCEKİ KONUŞMA (son mesajlar) ===\n${history}\n=== KONUŞMA SONU ===` : ""}

=== SORU ===
${input.question}
=== SORU SONU ===`;
}

/** Belge bağlamı sınıra sığmıyorsa kısaltır ve kullanıya bildirilecek işaret döner. */
export function withChatContextGuard(documentContent: string, maxChars = 60_000): {
  content: string;
  truncated: boolean;
} {
  if (documentContent.length <= maxChars) {
    return { content: documentContent, truncated: false };
  }
  const trimmed = normalizeSpacing(documentContent.slice(0, maxChars));
  return { content: `${trimmed}\n\n[NOT: Belge çok uzun; yalnızca ilk bölüm bağlama dahil edildi.]`, truncated: true };
}
