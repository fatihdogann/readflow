"use client";

import { useState } from "react";
import type { FolderRow } from "@/lib/db/repo/folders";
import type { JobRow } from "@/lib/db/repo/jobs";
import type { DocumentDetail } from "@/lib/documents/service";
import type { SummaryLevel } from "@/lib/types";
import { useDocDetail } from "./doc/useDocDetail";
import { DocHeader } from "./doc/DocHeader";
import { AiActions, type AiSelection } from "./doc/AiActions";
import { ContentTabs } from "./doc/ContentTabs";
import { NotesPanel } from "./doc/NotesPanel";

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
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-5xl justify-center gap-6">
      <div className="flex w-full min-w-0 max-w-3xl flex-col gap-6">
        {statusError ? (
          <p role="alert" className="no-print rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Durum bilgisi alınamıyor (sunucuya erişilemiyor). Belge ve kayıtlı çıktılar güvende.
          </p>
        ) : null}

        <DocHeader detail={detail} folders={folders} onChange={setDetail} onNotesToggle={() => setNotesOpen((value) => !value)} notesOpen={notesOpen} />

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
        />
      </div>

      <NotesPanel
        key={`panel-${detail.document.id}`}
        documentId={detail.document.id}
        initialNote={detail.document.note}
        initialUpdatedAt={detail.document.note_updated_at}
        mode="panel"
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
      />
      <NotesPanel
        key={`drawer-${detail.document.id}`}
        documentId={detail.document.id}
        initialNote={detail.document.note}
        initialUpdatedAt={detail.document.note_updated_at}
        mode="drawer"
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
      />
    </div>
  );
}
