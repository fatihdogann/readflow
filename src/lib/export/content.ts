import type { ExportPayload } from "./types";

/**
 * Tüm dışa aktarmaların kullandığı tek içerik çözümleyicisi:
 * AI çıktısı (seçili revizyon) > Düzenlenmiş sürüm > Orijinal metin.
 */
export function payloadContent(payload: ExportPayload): string {
  if (payload.output) return payload.output.content;
  if (payload.editedContent !== undefined) return payload.editedContent;
  return payload.document.original_text;
}

/** Notlar dahil mi? (export üst bilgisinde açık gösterilir) */
export function payloadHasNote(payload: ExportPayload): boolean {
  return payload.document.note.trim().length > 0;
}
