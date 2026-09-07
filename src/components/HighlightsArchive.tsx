"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationWithDocument, AnnotationColor } from "@/lib/db/repo/annotations";

const COLORS: Array<{ value: AnnotationColor; label: string }> = [
  { value: "yellow", label: "Sarı" },
  { value: "green", label: "Yeşil" },
  { value: "lavender", label: "Lavanta" },
];

const SEARCH_DEBOUNCE_MS = 300;

/** Vurguları belge başlığına göre gruplar; sıra en yeni vurguya göre korunur. */
function groupByDocument(rows: AnnotationWithDocument[]) {
  const groups = new Map<number, { title: string; url: string | null; items: AnnotationWithDocument[] }>();
  for (const row of rows) {
    const existing = groups.get(row.document_id);
    if (existing) existing.items.push(row);
    else
      groups.set(row.document_id, {
        title: row.document_title || "Adsız",
        url: row.document_source_url,
        items: [row],
      });
  }
  return [...groups.entries()];
}

/** Vurguları dışa aktarılabilir Markdown'a çevirir. */
export function toMarkdown(rows: AnnotationWithDocument[]): string {
  const lines: string[] = ["# Vurgularım", ""];
  for (const [, group] of groupByDocument(rows)) {
    lines.push(`## ${group.title}`);
    if (group.url) lines.push(`<${group.url}>`);
    lines.push("");
    for (const item of group.items) {
      lines.push(`> ${item.quote.replace(/\n+/g, " ").trim()}`);
      if (item.note.trim()) lines.push("", item.note.trim());
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function HighlightsArchive() {
  const [rows, setRows] = useState<AnnotationWithDocument[]>([]);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<AnnotationColor | "">("");
  const [withNote, setWithNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (q: string, renk: string, notlu: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (renk) params.set("renk", renk);
      if (notlu) params.set("notlu", "1");
      const response = await fetch(`/api/annotations?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { annotations: AnnotationWithDocument[] };
      // Geç dönen eski istek yeni sonucu ezmesin.
      if (id !== requestId.current) return;
      setRows(body.annotations);
      setError(null);
    } catch {
      if (id === requestId.current) setError("Vurgular yüklenemedi");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query, color, withNote), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, color, withNote, load]);

  const groups = useMemo(() => groupByDocument(rows), [rows]);

  async function copyMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(toMarkdown(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Panoya kopyalanamadı");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Alıntı veya notta ara…"
          aria-label="Vurgularda ara"
          className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900"
        />
        <select
          value={color}
          onChange={(event) => setColor(event.target.value as AnnotationColor | "")}
          aria-label="Renk filtresi"
          className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        >
          <option value="">Tüm renkler</option>
          {COLORS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="flex min-h-[40px] items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
          <input
            type="checkbox"
            checked={withNote}
            onChange={(event) => setWithNote(event.target.checked)}
            className="accent-stone-700"
          />
          Notlu
        </label>
        <button
          type="button"
          onClick={() => void copyMarkdown()}
          disabled={rows.length === 0}
          className="min-h-[40px] rounded-lg border border-stone-300 px-3 text-xs hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          {copied ? "Kopyalandı ✓" : "Markdown kopyala"}
        </button>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400" aria-live="polite">
        {loading ? "Yükleniyor…" : `${rows.length} vurgu · ${groups.length} belge`}
      </p>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {!loading && rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 px-6 py-10 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          {query || color || withNote
            ? "Bu filtrelerle vurgu yok."
            : "Henüz vurgu yok — bir belgede metin seçip renk seçerek başla."}
        </div>
      ) : null}

      <ul className="flex flex-col gap-5">
        {groups.map(([documentId, group]) => (
          <li key={documentId} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <Link
                href={`/doc/${documentId}`}
                className="text-sm font-medium text-stone-900 hover:underline dark:text-stone-100"
              >
                {group.title}
              </Link>
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                {group.items.length} vurgu
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-stone-200 bg-white/60 p-3 dark:border-stone-800 dark:bg-stone-900/30"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full hl-dot-${item.color}`}
                      aria-hidden
                    />
                    <Link
                      href={`/doc/${documentId}`}
                      className="min-w-0 flex-1 text-sm italic leading-relaxed text-stone-700 hover:underline dark:text-stone-300"
                    >
                      “{item.quote}”
                    </Link>
                  </div>
                  {item.note.trim() ? (
                    <p className="mt-2 border-t border-stone-200 pt-2 text-xs leading-relaxed text-stone-600 dark:border-stone-800 dark:text-stone-400">
                      {item.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
