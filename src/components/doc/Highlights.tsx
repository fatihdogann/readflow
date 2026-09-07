"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mutateJson } from "@/lib/client/api";
import { buildQuoteContext, findQuoteRange, rangesOverlap, type MatchedRange } from "@/lib/annotations/match";
import type { AnnotationRow, AnnotationColor } from "@/lib/db/repo/annotations";

export interface SelectionPoint {
  start: number;
  end: number;
}

/** Seçim araç çubuğu ölçüleri (konumlandırma için) ve yoklama gecikmesi. */
const TOOLBAR_HEIGHT = 46;
const TOOLBAR_WIDTH = 300;
const SELECTION_DEBOUNCE_MS = 180;

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

export type UseAnnotations = ReturnType<typeof useAnnotations>;

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
 * bağlanamaz ve `onLinkedChange` ile panele bildirilir.
 *
 * HTML yalnızca React tarafından bir kez basılır; efekt her çalıştığında önceki
 * <mark>'ları çözüp yeniden sarar — tüm belgeyi tekrar parse etmez.
 */
export function HighlightedArticle({
  html,
  annotations,
  onLinkedChange,
}: {
  html: string;
  annotations: AnnotationRow[];
  onLinkedChange: (linkedIds: number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Önceki vurguları çöz: innerHTML'i yeniden yazmadan temiz sayfaya dön.
    for (const mark of Array.from(container.querySelectorAll("mark.hl"))) {
      mark.replaceWith(...Array.from(mark.childNodes));
    }
    container.normalize();

    const linked: number[] = [];
    for (const annotation of annotations) {
      const normQuote = normalizeOf(annotation.quote);
      if (!normQuote) continue;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node) {
        // Zaten vurgulanmış düğümlerin içine ikinci kez girme (çakışma).
        if (node.parentElement?.closest("mark.hl")) {
          node = walker.nextNode() as Text | null;
          continue;
        }
        const nodeText = node.textContent ?? "";
        const start = normalizeOf(nodeText).indexOf(normQuote);
        if (start !== -1) {
          const span = offsetInNode(nodeText, start, normQuote.length);
          if (span !== null && wrapRange(node, span, annotation)) {
            linked.push(annotation.id);
            break;
          }
        }
        node = walker.nextNode() as Text | null;
      }
    }
    onLinkedChange(linked);
  }, [html, annotations, onLinkedChange]);

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

/** Metin düğümünün bir parçasını <mark> ile sarar; sarılamazsa false döner. */
function wrapRange(
  node: Text,
  span: { start: number; end: number },
  annotation: AnnotationRow,
): boolean {
  const range = document.createRange();
  range.setStart(node, span.start);
  range.setEnd(node, span.end);
  const mark = document.createElement("mark");
  mark.id = `ann-${annotation.id}`;
  mark.className = `hl hl-${annotation.color}`;
  if (annotation.note) mark.title = annotation.note;
  try {
    range.surroundContents(mark);
    return true;
  } catch {
    // Düğüm sınırlarını aşan seçim: panelde "bağlanamadı" olarak kalır.
    return false;
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
  const [position, setPosition] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const [selection, setSelection] = useState<SelectionPoint | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const clear = () => {
      setPosition(null);
      setSelection(null);
    };

    const evaluate = () => {
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) return clear();
      const domRange = domSelection.getRangeAt(0);
      if (!container.contains(domRange.commonAncestorContainer)) return clear();
      const selectionText = domSelection.toString().trim();
      if (!selectionText) return clear();
      // Seçimi normalize edilmiş eşleştirmeyle orijinal metin ofsetlerine çevir
      const matched = findQuoteRange(fullTextResolver(), { quote: selectionText });
      if (!matched) return clear();

      // Araç çubuğu position:fixed — konum viewport'a göredir, scroll ofseti
      // EKLENMEZ (eklenirse sayfa kaydırılınca araç çubuğu ekrandan çıkar).
      const rect = domRange.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      // Tepede yer yoksa seçimin altına açılır, metnin üstüne binmez.
      const below = rect.top < TOOLBAR_HEIGHT + 8;
      setPosition({
        x: Math.min(Math.max(rect.left, 8), Math.max(8, viewportWidth - TOOLBAR_WIDTH - 8)),
        y: Math.min(
          below ? rect.bottom + 8 : rect.top - TOOLBAR_HEIGHT,
          viewportHeight - TOOLBAR_HEIGHT - 8,
        ),
        below,
      });
      setSelection({ start: matched.start, end: matched.end });
    };

    // selectionchange sürükleme boyunca sürekli tetiklenir ve her seferinde
    // tüm metinde arama yapardı; debounce hem donmayı hem mobilde tutamaç
    // ayarlanırken erken kapanmayı önler.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(evaluate, SELECTION_DEBOUNCE_MS);
    };

    document.addEventListener("mouseup", schedule);
    document.addEventListener("touchend", schedule);
    document.addEventListener("keyup", schedule);
    document.addEventListener("selectionchange", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("mouseup", schedule);
      document.removeEventListener("touchend", schedule);
      document.removeEventListener("keyup", schedule);
      document.removeEventListener("selectionchange", schedule);
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
      data-below={position.below || undefined}
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

/** Vurguya tıklayınca açılan küçük popover: not, renk, silme. */
export function HighlightPopover({
  annotation,
  position,
  onUpdate,
  onRemove,
  onAsk,
  onOpenNote,
  onClose,
}: {
  annotation: AnnotationRow;
  position: { x: number; y: number };
  onUpdate: (id: number, patch: { note?: string; color?: AnnotationColor }) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
  /** Bu alıntıyı sohbete taşır. */
  onAsk: (quote: string) => void;
  /** Rafta bu vurgunun notuna gider. */
  onOpenNote: (id: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(annotation.note);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        returnFocus?.focus();
      }
    };
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    // Sayfa kaydırılınca popover metinden kopmasın: konumu vurguya kilitle
    const onScroll = () => {
      const mark = document.getElementById(`ann-${annotation.id}`);
      if (!mark || !ref.current) return;
      const rect = mark.getBoundingClientRect();
      ref.current.style.left = `${Math.max(8, rect.left)}px`;
      ref.current.style.top = `${Math.max(8, rect.bottom + 6)}px`;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [annotation.id, onClose]);

  const colorDot = (color: AnnotationColor, label: string) => (
    <button
      key={color}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={annotation.color === color}
      onClick={() => void onUpdate(annotation.id, { color })}
      className={`h-6 w-6 rounded-full border hover:scale-110 transition-transform ${
        annotation.color === color ? "border-stone-900 dark:border-white" : "border-stone-300 dark:border-stone-600"
      } hl-dot-${color}`}
    />
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Vurgu detayı"
      className="no-print fixed z-50 w-64 rounded-lg border border-stone-300 bg-white p-2.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
      style={{
        left: Math.min(Math.max(position.x, 8), (typeof window !== "undefined" ? window.innerWidth : 800) - 272),
        top: Math.min(Math.max(position.y, 8), (typeof window !== "undefined" ? window.innerHeight : 800) - 180),
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          {colorDot("yellow", "Sarı")}
          {colorDot("green", "Yeşil")}
          {colorDot("lavender", "Lavanta")}
        </div>
        <button
          type="button"
          aria-label="Vurguyu kaldır"
          className="flex h-7 w-7 items-center justify-center rounded text-stone-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
          onClick={() => {
            void onRemove(annotation.id);
            onClose();
          }}
        >
          ×
        </button>
      </div>
      <p className="mt-1.5 max-h-16 overflow-y-auto text-[11px] italic text-stone-500 dark:text-stone-400">
        “{annotation.quote.slice(0, 160)}
        {annotation.quote.length > 160 ? "…" : ""}”
      </p>
      <textarea
        value={draft}
        onChange={(event) => {
          if (event.target.value.length <= 5000) setDraft(event.target.value);
        }}
        onBlur={() => {
          if (draft !== annotation.note) void onUpdate(annotation.id, { note: draft });
        }}
        placeholder="Not ekle…"
        rows={3}
        aria-label="Vurgu notu"
        className="mt-1.5 w-full resize-none rounded border border-stone-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500"
      />
      <div className="mt-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onAsk(annotation.quote)}
          className="min-h-[32px] flex-1 rounded-md border border-stone-300 px-2 text-[11px] text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          AI&apos;a sor
        </button>
        <button
          type="button"
          onClick={() => onOpenNote(annotation.id)}
          className="min-h-[32px] flex-1 rounded-md border border-stone-300 px-2 text-[11px] text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          Rafta aç
        </button>
      </div>
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
  onAsk,
  linkedIds,
}: {
  annotations: AnnotationRow[];
  focusNoteId: number | null;
  onUpdate: (id: number, patch: { note?: string; color?: AnnotationColor }) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
  onGoTo: (id: number) => void;
  /** Alıntıyı sohbete taşır. */
  onAsk: (quote: string) => void;
  /** Metinde gerçekten bulunabilen vurgular; diğerleri "bağlanamadı" gösterilir. */
  linkedIds: number[];
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
        const linked = linkedIds.includes(annotation.id);
        return (
          <li key={annotation.id} className="rounded-lg border border-stone-200 p-2.5 text-xs dark:border-stone-800">
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full hl-dot-${annotation.color}`} aria-hidden />
              <button
                type="button"
                onClick={() => onGoTo(annotation.id)}
                disabled={!linked}
                className="min-h-[24px] flex-1 truncate text-left italic text-stone-600 hover:underline disabled:cursor-default disabled:no-underline dark:text-stone-300"
                title={linked ? "Vurguya git" : "Metinde karşılığı bulunamadı"}
              >
                “{annotation.quote.slice(0, 80)}
                {annotation.quote.length > 80 ? "…" : ""}”
              </button>
              <button
                type="button"
                onClick={() => onAsk(annotation.quote)}
                aria-label="Bu alıntıyı AI'a sor"
                title="AI'a sor"
                className="shrink-0 rounded px-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                ✦
              </button>
              <button
                type="button"
                onClick={() => void onRemove(annotation.id)}
                aria-label="Vurguyu kaldır"
                className="shrink-0 text-stone-400 hover:text-red-500"
              >
                ×
              </button>
            </div>

            {!linked ? (
              <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                Metinde karşılığı bulunamadı — alıntı ve notun saklı
              </p>
            ) : null}
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
