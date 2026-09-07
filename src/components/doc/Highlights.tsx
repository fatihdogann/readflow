"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mutateJson } from "@/lib/client/api";
import { buildQuoteContext, findQuoteRange, rangesOverlap, type MatchedRange } from "@/lib/annotations/match";
import type { AnnotationRow, AnnotationColor } from "@/lib/db/repo/annotations";

export interface SelectionPoint {
  start: number;
  end: number;
}

/** Dokümanın vurgularını yükleyip değiştirmek için hook. */
export function useAnnotations(documentId: number) {
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/annotations`, { cache: "no-store" });
      if (response.ok) {
        const body = (await response.json()) as { annotations: AnnotationRow[] };
        setAnnotations(body.annotations);
        setLoaded(true);
      }
    } catch {
      /* yoksay */
    }
  }, [documentId]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(initial);
  }, [refresh]);

  const create = useCallback(
    async (input: {
      contentKind: "original" | "edited";
      contentRevision: number;
      selection: SelectionPoint;
      fullText: string;
      color: AnnotationColor;
    }): Promise<{ ok: boolean; message: string; annotationId?: number }> => {
      const { quote, prefix, suffix } = buildQuoteContext(
        input.fullText,
        input.selection.start,
        input.selection.end,
      );
      if (!quote.trim()) return { ok: false, message: "Boş seçim vurgulanamaz" };
      try {
        const body = await mutateJson<{ annotation: AnnotationRow }>(
          `/api/documents/${documentId}/annotations`,
          "POST",
          {
            contentKind: input.contentKind,
            contentRevision: input.contentRevision,
            quote,
            prefix,
            suffix,
            color: input.color,
          },
        );
        setAnnotations((prev) => [...prev, body.annotation]);
        return { ok: true, message: "Vurgu eklendi.", annotationId: body.annotation.id };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Vurgu eklenemedi" };
      }
    },
    [documentId],
  );

  const update = useCallback(
    async (id: number, patch: { note?: string; color?: AnnotationColor }) => {
      try {
        const body = await mutateJson<{ annotation: AnnotationRow }>(`/api/annotations/${id}`, "PATCH", patch);
        setAnnotations((prev) => prev.map((item) => (item.id === id ? body.annotation : item)));
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const remove = useCallback(async (id: number) => {
    try {
      await mutateJson(`/api/annotations/${id}`, "DELETE");
      setAnnotations((prev) => prev.filter((item) => item.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { annotations, loaded, refresh, create, update, remove };
}

/** Vurgu aralıklarını hesaplar (çakışma kontrolüyle). */
export function computeRanges(
  fullText: string,
  annotations: AnnotationRow[],
): Array<{ annotation: AnnotationRow; range: MatchedRange | null }> {
  const ranges = annotations.map((annotation) => ({
    annotation,
    range: findQuoteRange(fullText, annotation),
  }));
  // Çakışan vurgular: yalnızca ilk (en eski) bağlanır; sonrakiler "bağlantı yok" olur.
  const accepted: MatchedRange[] = [];
  return ranges.map(({ annotation, range }) => {
    if (!range) return { annotation, range: null };
    if (accepted.some((existing) => rangesOverlap(existing, range))) {
      return { annotation, range: null };
    }
    accepted.push(range);
    return { annotation, range };
  });
}

/** Düz metni vurgu işaretleriyle render eder. */
export function HighlightedText({
  text,
  entries,
}: {
  text: string;
  entries: Array<{ annotation: AnnotationRow; range: MatchedRange | null }>;
}) {
  const segments = useMemo(() => {
    const sorted = entries
      .filter((entry) => entry.range !== null)
      .sort((a, b) => a.range!.start - b.range!.start);
    const parts: Array<{ text: string; annotation?: AnnotationRow }> = [];
    let cursor = 0;
    for (const entry of sorted) {
      const { start, end } = entry.range!;
      if (start < cursor) continue;
      if (start > cursor) parts.push({ text: text.slice(cursor, start) });
      parts.push({ text: text.slice(start, end), annotation: entry.annotation });
      cursor = end;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor) });
    return parts;
  }, [text, entries]);

  return (
    <>
      {segments.map((segment, index) =>
        segment.annotation ? (
          <mark
            key={index}
            id={`ann-${segment.annotation.id}`}
            className={`hl hl-${segment.annotation.color}`}
            title={segment.annotation.note || undefined}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Sanitize edilmiş HTML içinde metin düğümlerinde vurgu arar ve <mark> ile sarar.
 * Yalnızca tek metin düğümü içindeki eşleşmeler bağlanır; düğümler arası alıntı
 * "bağlantısı bulunamadı" olarak panelde kalır.
 */
export function HighlightedArticle({
  html,
  entries,
}: {
  html: string;
  entries: Array<{ annotation: AnnotationRow; range: MatchedRange | null }>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = html;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const targets: Array<{ node: Text; annotation: AnnotationRow; range: MatchedRange }> = [];
    for (const entry of entries) {
      if (!entry.range) continue;
      const normQuote = entry.annotation.quote.replace(/\s+/g, " ").trim();
      if (!normQuote) continue;
      walker.currentNode = container;
      let node = walker.nextNode() as Text | null;
      let placed = false;
      while (node && !placed) {
        const nodeText = node.textContent ?? "";
        const start = normalizeOf(nodeText).indexOf(normQuote);
        if (start !== -1) {
      const realSpan = offsetInNode(nodeText, start, normQuote.length);
      if (realSpan !== null) {
        targets.push({ node, annotation: entry.annotation, range: realSpan });
        placed = true;
      }
        }
        node = walker.nextNode() as Text | null;
      }
    }
    for (const target of targets) {
      try {
        wrapRange(target.node, target.range, target.annotation);
      } catch {
        /* kırpılamayan düğüm: panelde bağlantısız kalır */
      }
    }
  }, [html, entries]);

  return <article ref={containerRef} className="article" dangerouslySetInnerHTML={{ __html: html }} />;
}

function normalizeOf(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** normalize edilmiş başlangıcı gerçek düğüm ofsetine çevirir. */
function offsetInNode(
  nodeText: string,
  normStart: number,
  normLength: number,
): { start: number; end: number } | null {
  const map: number[] = [];
  let ni = 0;
  let inWs = false;
  let started = false;
  for (let oi = 0; oi < nodeText.length; oi++) {
    const ch = nodeText[oi];
    const isWs = /\s/.test(ch);
    if (isWs && started) {
      map[ni++] = oi;
      inWs = true;
      continue;
    }
    if (isWs) continue;
    if (inWs) inWs = false;
    map[ni] = oi;
    ni += 1;
    started = true;
  }
  map[ni] = nodeText.length;
  const start = map[normStart];
  const end = map[normStart + normLength];
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

function wrapRange(
  node: Text,
  span: { start: number; end: number },
  annotation: AnnotationRow,
): void {
  const range = document.createRange();
  range.setStart(node, span.start);
  range.setEnd(node, span.end);
  const mark = document.createElement("mark");
  mark.id = `ann-${annotation.id}`;
  mark.className = `hl hl-${annotation.color}`;
  if (annotation.note) mark.title = annotation.note;
  try {
    range.surroundContents(mark);
  } catch {
    /* kırpılamayan düğüm: panelde bağlantısız kalır */
  }
}

/** Seçim araç çubuğu: okuma alanında seçim varken belirir. */
export function SelectionToolbar({
  containerSelector,
  contentKind,
  contentRevision,
  fullTextResolver,
  onCreate,
  onNoteCreated,
  onAskWithQuote,
}: {
  containerSelector: string;
  contentKind: "original" | "edited";
  contentRevision: number;
  fullTextResolver: () => string;
  onCreate: (input: {
    contentKind: "original" | "edited";
    contentRevision: number;
    selection: SelectionPoint;
    fullText: string;
    color: AnnotationColor;
  }) => Promise<{ ok: boolean; message: string; annotationId?: number }>;
  onNoteCreated: (annotationId: number) => void;
  onAskWithQuote: (quote: string) => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<SelectionPoint | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const onMouseUp = () => {
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) {
        setPosition(null);
        setSelection(null);
        return;
      }
      const domRange = domSelection.getRangeAt(0);
      if (!container.contains(domRange.commonAncestorContainer)) {
        setPosition(null);
        setSelection(null);
        return;
      }
      const fullText = fullTextResolver();
      const selectionText = domSelection.toString().trim();
      if (!selectionText) {
        setPosition(null);
        setSelection(null);
        return;
      }
      // Seçimi normalize edilmiş eşleştirmeyle orijinal metin ofsetlerine çevir
      const matched = findQuoteRange(fullText, { quote: selectionText });
      if (!matched) {
        setPosition(null);
        setSelection(null);
        return;
      }
      const domRect = domRange.getBoundingClientRect();
      setPosition({
        x: domRect.left + window.scrollX,
        y: domRect.top + window.scrollY - 46,
      });
      setSelection({ start: matched.start, end: matched.end });
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onMouseUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onMouseUp);
    };
  }, [containerSelector, fullTextResolver]);

  if (!position || !selection) return null;

  const addHighlight = (color: AnnotationColor) => {
    void onCreate({
      contentKind,
      contentRevision,
      selection,
      fullText: fullTextResolver(),
      color,
    }).then((result) => {
      setFeedback(result.ok ? null : result.message);
      if (result.ok) {
        window.getSelection()?.removeAllRanges();
        setPosition(null);
        setSelection(null);
      }
    });
  };

  const addNote = () => {
    void onCreate({
      contentKind,
      contentRevision,
      selection,
      fullText: fullTextResolver(),
      color: "yellow",
    }).then((result) => {
      if (result.ok && result.annotationId) {
        window.getSelection()?.removeAllRanges();
        setPosition(null);
        setSelection(null);
        onNoteCreated(result.annotationId);
      } else {
        setFeedback(result.message);
      }
    });
  };

  return (
    <div
      role="toolbar"
      aria-label="Vurgu araçları"
      className="no-print fixed z-40 flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 shadow-lg dark:border-stone-700 dark:bg-stone-900"
      style={{ left: position.x, top: Math.max(position.y, 8) }}
    >
      {(
        [
          { color: "yellow" as const, label: "Sarı vurgu", dot: "bg-yellow-300" },
          { color: "green" as const, label: "Yeşil vurgu", dot: "bg-green-300" },
          { color: "lavender" as const, label: "Lavanta vurgu", dot: "bg-purple-300" },
        ]
      ).map((option) => (
        <button
          key={option.color}
          type="button"
          title={option.label}
          aria-label={option.label}
          className={`h-9 w-9 rounded-full ${option.dot} border border-stone-400/50 hover:scale-110 transition-transform`}
          onClick={() => addHighlight(option.color)}
        />
      ))}
      <span className="mx-0.5 h-5 w-px bg-stone-200 dark:bg-stone-700" aria-hidden />
      <button
        type="button"
        title="Seçime vurgu ekleyip not yaz"
        aria-label="Not ekle"
        className="h-9 rounded px-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
        onClick={addNote}
      >
        Not ekle
      </button>
      <button
        type="button"
        title="Seçili bölümü sohbette sor"
        aria-label="AI'a sor"
        className="h-9 rounded px-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
        onClick={() => {
          onAskWithQuote(fullTextResolver().slice(selection.start, selection.end));
          window.getSelection()?.removeAllRanges();
          setPosition(null);
          setSelection(null);
        }}
      >
        AI&apos;a sor
      </button>
      {feedback ? <span className="px-1 text-[11px] text-red-600 dark:text-red-400">{feedback}</span> : null}
    </div>
  );
}

/** Vurgu notlarının panel listesi ( popover yerine satır içi düzenleme). */
export function AnnotationList({
  annotations,
  focusNoteId,
  onUpdate,
  onRemove,
  onGoTo,
}: {
  annotations: AnnotationRow[];
  focusNoteId: number | null;
  onUpdate: (id: number, patch: { note?: string; color?: AnnotationColor }) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
  onGoTo: (id: number) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const lastFocused = useRef<number | null>(null);

  useEffect(() => {
    if (focusNoteId === null || focusNoteId === lastFocused.current) return;
    lastFocused.current = focusNoteId;
    const timer = setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>(`textarea[data-ann-id="${focusNoteId}"]`)
        ?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [focusNoteId]);

  if (annotations.length === 0) {
    return (
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Henüz vurgu yok — metinde bir bölüm seçip renk seçerek vurgu ekle.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {annotations.map((annotation) => {
        return (
          <li key={annotation.id} className="rounded-lg border border-stone-200 p-2.5 text-xs dark:border-stone-800">
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full hl-dot-${annotation.color}`} aria-hidden />
              <button
                type="button"
                onClick={() => onGoTo(annotation.id)}
                className="min-h-[24px] flex-1 truncate text-left italic text-stone-600 hover:underline dark:text-stone-300"
                title="Vurguya git"
              >
                “{annotation.quote.slice(0, 80)}
                {annotation.quote.length > 80 ? "…" : ""}”
              </button>
              <button
                type="button"
                onClick={() => void onRemove(annotation.id)}
                aria-label="Vurguyu kaldır"
                className="text-stone-400 hover:text-red-500"
              >
                ×
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <textarea
                value={drafts[annotation.id] ?? annotation.note}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [annotation.id]: event.target.value }))}
                onBlur={() => {
                  const draft = drafts[annotation.id] ?? annotation.note;
                  if (draft !== annotation.note) void onUpdate(annotation.id, { note: draft });
                }}
                data-ann-id={annotation.id}
                placeholder="Bu alıntıya not ekle…"
                rows={2}
                aria-label="Alıntı notu"
                className="w-full resize-none rounded border border-stone-200 bg-white px-2 py-1 text-xs outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
