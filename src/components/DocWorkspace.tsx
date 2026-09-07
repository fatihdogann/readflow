"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FolderRow } from "@/lib/db/repo/folders";
import type { JobRow } from "@/lib/db/repo/jobs";
import type { DocumentDetail } from "@/lib/documents/service";
import type { SummaryLevel } from "@/lib/types";
import { useDocDetail } from "./doc/useDocDetail";
import { DocHeader } from "./doc/DocHeader";
import { AiActions, type AiSelection } from "./doc/AiActions";
import { ContentTabs } from "./doc/ContentTabs";
import { NotesPanel } from "./doc/NotesPanel";
import { ChatPanel } from "./doc/ChatPanel";
import { RightRail, type RailTab } from "./doc/RightRail";
import { AnnotationList, useAnnotations } from "./doc/Highlights";
import { notifyFoldersChanged } from "@/lib/client/events";

/** Silme sonrası "Geri al" penceresi; dolunca arşive yönlendirilir. */
const UNDO_WINDOW_MS = 12_000;

export function DocWorkspace({
  initial,
  folders,
}: {
  initial: DocumentDetail;
  folders: FolderRow[];
}) {
  const { detail, setDetail, refresh, statusError } = useDocDetail(initial);
  const [tab, setTab] = useState<"original" | "edited" | "ai-edit" | "summary">("original");
  const [selection, setSelection] = useState<AiSelection>({
    aiProfileId: null,
    sourceKind: "auto",
    includeNotes: false,
    summaryLevel: "normal",
  });
  const [notice, setNotice] = useState<string | null>(null);
  // Tek yardımcı sütun: Not / Vurgular / AI'a sor aynı rafta sekme.
  const [rail, setRail] = useState<RailTab | null>(null);
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const [focusNoteId, setFocusNoteId] = useState<number | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const router = useRouter();

  const annotationStore = useAnnotations(detail.document.id);
  const { annotations, update: updateAnnotation, remove: removeAnnotation } = annotationStore;

  // Silindikten sonra geri alma penceresi: süre dolunca arşive dön.
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => router.push("/history"), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [deleted, router]);

  const toggleRail = (next: RailTab): void => setRail((current) => (current === next ? null : next));

  /** Vurgu notunu düzenlemek için rafı Vurgular sekmesinde açar. */
  const focusNote = useCallback((annotationId: number): void => {
    setRail("highlights");
    setFocusNoteId(annotationId);
  }, []);

  const askWithQuote = useCallback((quote: string): void => {
    setPendingQuote(quote);
    setRail("chat");
  }, []);

  /** Vurguya git: metinde konumuna kaydır ve kısa süre yanıp sönsün. */
  const goToAnnotation = (id: number): void => {
    const element = document.getElementById(`ann-${id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("hl-flash");
    setTimeout(() => element.classList.remove("hl-flash"), 1600);
  };

  async function undoDelete(): Promise<void> {
    setUndoError(null);
    try {
      const response = await fetch(`/api/documents/${detail.document.id}`, { method: "POST" });
      if (!response.ok) throw new Error("Geri alınamadı");
      notifyFoldersChanged();
      setDeleted(false);
    } catch {
      setUndoError("Geri alınamadı — arşivden tekrar dene");
    }
  }

  if (deleted) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-stone-200 bg-white/70 px-6 py-12 text-center dark:border-stone-800 dark:bg-stone-900/35">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          <strong className="text-stone-900 dark:text-stone-100">{detail.document.title}</strong> silindi.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void undoDelete()}
            autoFocus
            className="min-h-[40px] rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Geri al
          </button>
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="min-h-[40px] rounded-lg border border-stone-300 px-4 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Arşive dön
          </button>
        </div>
        {undoError ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {undoError}
          </p>
        ) : null}
        <p className="text-[11px] text-stone-500 dark:text-stone-400">
          Bu pencere kapanınca arşive dönersin; doküman çöpte kalır.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto flex w-full justify-center gap-8 transition-[max-width] duration-300 ${
        rail ? "max-w-6xl" : "max-w-5xl"
      }`}
    >
      <div className="flex w-full min-w-0 max-w-3xl flex-col gap-6">
        {statusError ? (
          <p role="alert" className="no-print rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Durum bilgisi alınamıyor (sunucuya erişilemiyor). Belge ve kayıtlı çıktılar güvende.
          </p>
        ) : null}

        <DocHeader
          detail={detail}
          folders={folders}
          onChange={setDetail}
          rail={rail}
          onRailToggle={toggleRail}
          highlightCount={annotations.length}
          onDeleted={() => setDeleted(true)}
        />

        <AiActions
          detail={detail}
          selection={selection}
          onSelectionChange={setSelection}
          onJobsChange={(jobs: JobRow[]) => {
            setDetail({ ...detail, jobs });
            void refresh();
          }}
          onNotice={setNotice}
        />

        {notice ? (
          <p role="status" aria-live="polite" className="no-print text-xs text-amber-700 dark:text-amber-400">
            {notice}
          </p>
        ) : null}

        <ContentTabs
          detail={detail}
          tab={tab}
          onTabChange={setTab}
          summaryLevel={selection.summaryLevel}
          onSummaryLevelChange={(level: SummaryLevel) => setSelection((prev) => ({ ...prev, summaryLevel: level }))}
          onNotice={setNotice}
          onEditChange={(edit) => setDetail({ ...detail, edit })}
          onAskWithQuote={askWithQuote}
          annotations={annotationStore}
          onFocusNote={focusNote}
        />
      </div>

      {rail ? (
        <RightRail
          tab={rail}
          onTabChange={setRail}
          onClose={() => setRail(null)}
          badges={{
            note: detail.document.note ? "•" : undefined,
            highlights: annotations.length > 0 ? String(annotations.length) : undefined,
          }}
        >
          {rail === "note" ? (
            <NotesPanel
              key={detail.document.id}
              documentId={detail.document.id}
              initialNote={detail.document.note}
              initialUpdatedAt={detail.document.note_updated_at}
            />
          ) : null}
          {rail === "highlights" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AnnotationList
                annotations={annotations}
                focusNoteId={focusNoteId}
                onUpdate={(id, patch) => updateAnnotation(id, patch)}
                onRemove={(id) => removeAnnotation(id)}
                onGoTo={goToAnnotation}
                onAsk={askWithQuote}
              />
            </div>
          ) : null}
          {rail === "chat" ? (
            <ChatPanel
              documentId={detail.document.id}
              pendingQuote={pendingQuote}
              onQuoteConsumed={() => setPendingQuote(null)}
            />
          ) : null}
        </RightRail>
      ) : null}
    </div>
  );
}
