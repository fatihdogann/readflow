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

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/**
 * Bir AI çıktısı için dışa aktarma menüsü.
 * Pano/TXT/Markdown tamamen tarayıcıda; DOCX ve uzak hedefler sunucu API'sinden.
 */
export function ExportMenu({
  document: doc,
  output,
  onMessage,
}: {
  document: DocumentRow;
  output: OutputRow;
  onMessage: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function postTarget(target: "docx" | "notion" | "telegram"): Promise<void> {
    setBusy(target);
    try {
      const response = await fetch(`/api/export/${target}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outputId: output.id }),
      });
      if (target === "docx") {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          onMessage(body?.error ?? "DOCX üretilemedi");
          return;
        }
        const blob = await response.blob();
        downloadFile(`${slugify(doc.title)}.docx`, blob, "application/octet-stream");
        onMessage("DOCX indirildi.");
        return;
      }
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;
      onMessage(body?.message ?? "İşlem tamamlanamadı");
    } catch {
      onMessage("Sunucuya ulaşılamadı");
    } finally {
      setBusy(null);
    }
  }

  const base = slugify(doc.title);
  const payload = { document: doc, output };
  const itemClass =
    "block w-full px-3 py-1.5 text-left text-xs hover:bg-stone-100 disabled:opacity-40 dark:hover:bg-stone-800";

  return (
    <details className="no-print relative">
      <summary className="cursor-pointer list-none rounded-md border border-stone-300 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800">
        Dışa Aktar
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            void copyToClipboard(output.content).then(
              () => onMessage("Panoya kopyalandı."),
              () => onMessage("Kopyalanamadı"),
            );
          }}
        >
          Panoya Kopyala
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => downloadFile(`${base}.txt`, buildTxt(payload), "text/plain")}
        >
          TXT indir
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => downloadFile(`${base}.md`, buildMarkdown(payload), "text/markdown")}
        >
          Markdown indir
        </button>
        <button type="button" className={itemClass} onClick={() => window.print()}>
          PDF (Yazdır)
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
