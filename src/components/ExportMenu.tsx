"use client";

import { useState } from "react";
import { buildMarkdown, buildTxt, slugify } from "@/lib/export/format";
import type { DocumentRow } from "@/lib/db/repo/documents";
import type { OutputRow } from "@/lib/db/repo/outputs";

function downloadFile(filename: string, content: string | Blob, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Varyant-etiketli dışa aktarma menüsü. Pano/TXT/Markdown/PDF tarayıcıda;
 * DOCX ve uzak hedefler sunucudan (revizyon/Varyant bilgisiyle).
 */
export function ExportMenu({
  document: doc,
  output,
  editedContent,
  variantLabel,
  revisionId,
  onMessage,
}: {
  document: DocumentRow;
  output: OutputRow | null;
  editedContent?: string;
  variantLabel: string;
  revisionId?: number;
  onMessage: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const payload = output
    ? { document: doc, output, revisionId }
    : { document: doc, output: null, editedContent };
  const content = output ? output.content : (editedContent ?? doc.original_text);
  const base = `${slugify(doc.title)}-${slugify(variantLabel)}`;

  async function postTarget(target: "pdf" | "docx" | "notion" | "telegram"): Promise<void> {
    setBusy(target);
    try {
      const response = await fetch(`/api/export/${target}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outputId: output?.id,
          documentId: output ? undefined : doc.id,
          revisionId: revisionId ?? null,
          variantLabel,
        }),
      });
      if (target === "pdf" || target === "docx") {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
          onMessage(body?.error ?? body?.message ?? (target === "pdf" ? "PDF oluşturulamadı" : "DOCX üretilemedi"));
          return;
        }
        const blob = await response.blob();
        downloadFile(`${base}.${target}`, blob, "application/octet-stream");
        onMessage(`${variantLabel} ${target.toUpperCase()} indirildi.`);
        return;
      }
      const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      onMessage(body?.message ?? "İşlem tamamlanamadı");
    } catch {
      onMessage("Sunucuya ulaşılamadı");
    } finally {
      setBusy(null);
    }
  }

  const itemClass =
    "block w-full px-3 py-2 text-left text-xs hover:bg-stone-100 disabled:opacity-40 dark:hover:bg-stone-800";

  return (
    <details className="no-print relative">
      <summary className="cursor-pointer list-none rounded-md border border-stone-300 px-2.5 py-1.5 text-xs text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800">
        Dışa Aktar · {variantLabel}
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            void navigator.clipboard
              .writeText(content)
              .then(() => onMessage("Panoya kopyalandı."))
              .catch(() => onMessage("Kopyalanamadı"));
          }}
        >
          Panoya Kopyala
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => downloadFile(`${base}.txt`, buildTxt(payload, variantLabel), "text/plain")}
        >
          TXT indir
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => downloadFile(`${base}.md`, buildMarkdown(payload, variantLabel), "text/markdown")}
        >
          Markdown indir
        </button>
        <button type="button" className={itemClass} onClick={() => window.print()}>
          Yazdır…
        </button>
        <button type="button" className={itemClass} disabled={busy !== null} onClick={() => void postTarget("pdf")}>
          {busy === "pdf" ? "PDF hazırlanıyor…" : "PDF indir"}
        </button>
        <button type="button" className={itemClass} disabled={busy !== null} onClick={() => void postTarget("docx")}>
          {busy === "docx" ? "DOCX üretiliyor…" : "DOCX indir"}
        </button>
        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
        <button type="button" className={itemClass} disabled={busy !== null} onClick={() => void postTarget("notion")}>
          {busy === "notion" ? "Gönderiliyor…" : "Notion'a gönder"}
        </button>
        <button type="button" className={itemClass} disabled={busy !== null} onClick={() => void postTarget("telegram")}>
          {busy === "telegram" ? "Gönderiliyor…" : "Telegram'a gönder"}
        </button>
      </div>
    </details>
  );
}
