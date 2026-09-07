"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mutateJson } from "@/lib/client/api";
import type { DocumentDetail } from "@/lib/documents/service";
import type { OutputRow } from "@/lib/db/repo/outputs";
import { summaryLevelLabel, SUMMARY_LEVELS, type SummaryLevel } from "@/lib/types";
import { ExportMenu } from "../ExportMenu";
import { EditorPanel } from "./EditorPanel";
import {
  computeRanges,
  HighlightedArticle,
  HighlightedText,
  HighlightPopover,
  SelectionToolbar,
  type UseAnnotations,
} from "./Highlights";
import { EditIcon } from "@/components/Icons";

interface RevisionMeta {
  id: number;
  agent_name: string | null;
  job_id: number | null;
  created_at: string;
  content: string;
}

type TabKey = "original" | "edited" | "ai-edit" | "summary";

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="article">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

/** Erişilebilir sekme listesi: role=tablist + ok tuşu gezinmesi. */
function TabButton({
  active,
  label,
  panelId,
  onSelect,
  index,
  setIndex,
  tabIds,
}: {
  active: boolean;
  label: string;
  panelId: string;
  onSelect: () => void;
  index: number;
  setIndex: (index: number) => void;
  tabIds: string[];
}) {
  return (
    <button
      id={`tab-${panelId}`}
      role="tab"
      aria-selected={active}
      aria-controls={`panel-${panelId}`}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const delta = event.key === "ArrowRight" ? 1 : -1;
          const next = (index + delta + tabIds.length) % tabIds.length;
          setIndex(next);
          document.getElementById(`tab-${tabIds[next]}`)?.focus();
        }
      }}
      className={`min-h-[40px] border-b-2 px-3 py-2 text-sm ${
        active
          ? "border-stone-900 font-medium text-stone-900 dark:border-stone-100 dark:text-stone-100"
          : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
      }`}
    >
      {label}
    </button>
  );
}

function useRevisions(outputId: number | null): RevisionMeta[] {
  const [revisions, setRevisions] = useState<RevisionMeta[]>([]);
  useEffect(() => {
    if (!outputId) return;
    let cancelled = false;
    void fetch(`/api/outputs/${outputId}/revisions`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { revisions?: RevisionMeta[] } | null) => {
        if (!cancelled && body?.revisions) setRevisions(body.revisions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [outputId]);
  return revisions;
}

function RevisionPicker({
  outputId,
  onSelect,
  selectedId,
}: {
  outputId: number | null;
  onSelect: (revision: { id: number; content: string } | null) => void;
  selectedId: number | null;
}) {
  const revisions = useRevisions(outputId);
  if (revisions.length <= 0) return null;
  return (
    <label className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
      Sürüm:
      <select
        value={selectedId === null ? "" : String(selectedId)}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "") {
            onSelect(null);
            return;
          }
          const revision = revisions.find((candidate) => candidate.id === Number(value));
          if (revision) onSelect({ id: revision.id, content: revision.content });
        }}
        className="min-h-[32px] rounded border border-stone-300 bg-white px-1.5 py-1 dark:border-stone-700 dark:bg-stone-900"
      >
        <option value="">Güncel</option>
        {revisions.map((revision) => (
          <option key={revision.id} value={String(revision.id)}>
            {revision.created_at.slice(0, 16).replace("T", " ")} · {revision.agent_name ?? "agent"}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ContentTabs({
  detail,
  tab,
  onTabChange,
  summaryLevel,
  onSummaryLevelChange,
  onNotice,
  onEditChange,
  onAskWithQuote,
  annotations: annotationStore,
  onFocusNote,
  onLinkedChange,
}: {
  detail: DocumentDetail;
  tab: TabKey;
  onTabChange: (tab: TabKey) => void;
  summaryLevel: SummaryLevel;
  onSummaryLevelChange: (level: SummaryLevel) => void;
  onNotice: (message: string) => void;
  onEditChange: (edit: DocumentDetail["edit"]) => void;
  onAskWithQuote: (quote: string) => void;
  annotations: UseAnnotations;
  /** Vurgu notunu düzenlemek için sağ rafı Vurgular sekmesinde açar. */
  onFocusNote: (annotationId: number) => void;
  /** Metinde gerçekten bağlanabilen vurgu kimlikleri (rafta rozet için). */
  onLinkedChange: (linkedIds: number[]) => void;
}) {
  const doc = detail.document;
  const [editing, setEditing] = useState(false);
  const [compare, setCompare] = useState(false);
  const [aiRevision, setAiRevision] = useState<{ id: number; content: string } | null>(null);
  const [summaryRevision, setSummaryRevision] = useState<{ id: number; content: string } | null>(null);
  const { annotations, create: createAnnotation, update: updateAnnotation, remove: removeAnnotation } = annotationStore;

  // Referans sabit kalsın: HighlightedArticle efekti her render'da <mark>'ları
  // çözüp yeniden sarmasın.
  const originalAnnotations = useMemo(
    () => annotations.filter((item) => item.content_kind === "original"),
    [annotations],
  );
  const originalEntries = useMemo(
    () => computeRanges(doc.original_text, originalAnnotations),
    [doc.original_text, originalAnnotations],
  );

  // Düz metin yolunda bağlanan vurgular aralık hesabından bilinir; HTML yolunda
  // HighlightedArticle kendi sonucunu bildirir.
  const isHtmlPath = doc.source_type === "url" && doc.original_html !== null;
  useEffect(() => {
    if (isHtmlPath) return;
    onLinkedChange(
      originalEntries.filter((entry) => entry.range !== null).map((entry) => entry.annotation.id),
    );
  }, [isHtmlPath, originalEntries, onLinkedChange]);

  const [popover, setPopover] = useState<{ id: number; x: number; y: number } | null>(null);
  const onMarkClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName !== "MARK" || !target.id.startsWith("ann-")) return;
    const id = Number(target.id.slice(4));
    const annotation = annotations.find((candidate) => candidate.id === id);
    if (!annotation) return;
    // Popover position:fixed — viewport koordinatı kullanılır, scroll eklenmez.
    const rect = target.getBoundingClientRect();
    setPopover({ id, x: rect.left, y: rect.bottom + 6 });
  }, [annotations]);

  const readabilityOutput = useMemo(
    () => detail.outputs.find((output) => output.operation === "readability") ?? null,
    [detail.outputs],
  );
  const summaryOutputs = detail.outputs.filter((output) => output.operation === "summary");
  const summaryOutput = summaryOutputs.find((output) => output.summary_level === summaryLevel) ?? null;
  const activeLevels = useMemo(
    () => SUMMARY_LEVELS.filter((level) => summaryOutputs.some((output) => output.summary_level === level)),
    [summaryOutputs],
  );
  const isActive = (operation: string, level?: string): boolean =>
    detail.jobs.some(
      (job) =>
        (job.status === "pending" || job.status === "processing") &&
        job.operation === operation &&
        (level === undefined || job.summary_level === level),
    );

  const tabs = useMemo(
    () =>
      (
        [
          { key: "original" as TabKey, label: "Orijinal", show: true },
          { key: "edited" as TabKey, label: "Düzenlenmiş", show: true },
          {
            key: "ai-edit" as TabKey,
            label: "AI Düzenlemesi",
            show: readabilityOutput !== null || isActive("readability"),
          },
          {
            key: "summary" as TabKey,
            label: "Özet",
            show: activeLevels.length > 0 || SUMMARY_LEVELS.some((level) => isActive("summary", level)),
          },
        ] as Array<{ key: TabKey; label: string; show: boolean }>
      ).filter((entry) => entry.show),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readabilityOutput, activeLevels, detail.jobs],
  );

  const effectiveTab: TabKey = tabs.some((entry) => entry.key === tab) ? tab : "original";

  async function takeAsEdited(output: OutputRow, content: string): Promise<void> {
    if (
      detail.edit &&
      detail.edit.content.trim() &&
      !window.confirm("Mevcut Düzenlenmiş sürümün üzerine yazılsın mı? (Orijinal etkilenmez)")
    ) {
      return;
    }
    try {
      const body = await mutateJson<{ edit: DocumentDetail["edit"] }>(
        `/api/documents/${doc.id}/edit`,
        "PUT",
        { content, revision: detail.edit?.revision ?? 0 },
      );
      onEditChange(body.edit);
      onNotice("AI Düzenlemesi çalışma sürümüne alındı (Düzenlenmiş sekmesi).");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Alınamadı");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="İçerik görünümleri" className="no-print flex flex-wrap items-center gap-1 border-b border-stone-200 dark:border-stone-800">
        {tabs.map((entry, index) => (
          <TabButton
            key={entry.key}
            active={effectiveTab === entry.key}
            label={
              entry.key === "ai-edit" && isActive("readability")
                ? "AI Düzenlemesi …"
                : entry.key === "summary" && isActive("summary")
                  ? "Özet …"
                  : entry.label
            }
            panelId={entry.key}
            tabIds={tabs.map((candidate) => candidate.key)}
            index={index}
            setIndex={(next) => {
              const target = tabs[next];
              if (target) onTabChange(target.key);
            }}
            onSelect={() => onTabChange(entry.key)}
          />
        ))}
        <div className="ml-auto flex items-center gap-2 py-1">
          {effectiveTab === "summary" && activeLevels.length > 0 ? (
            <div role="radiogroup" aria-label="Özet sürümü" className="flex overflow-hidden rounded-md border border-stone-300 dark:border-stone-700">
              {SUMMARY_LEVELS.filter((level) => activeLevels.includes(level) || isActive("summary", level)).map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={summaryLevel === level}
                  onClick={() => onSummaryLevelChange(level)}
                  className={`min-h-[36px] px-2.5 py-1 text-xs ${
                    summaryLevel === level
                      ? "bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-stone-100"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                  }`}
                >
                  {summaryLevelLabel[level]}
                  {isActive("summary", level) ? " …" : ""}
                </button>
              ))}
            </div>
          ) : null}
          {effectiveTab === "original" ? (
            <ExportMenu
              document={doc}
              output={null}
              variantLabel="Orijinal"
              onMessage={onNotice}
            />
          ) : null}
          {effectiveTab === "edited" && detail.edit ? (
            <ExportMenu
              document={doc}
              output={null}
              editedContent={detail.edit.content}
              variantLabel="Düzenlenmiş"
              onMessage={onNotice}
            />
          ) : null}
          {effectiveTab === "ai-edit" && readabilityOutput ? (
            <>
              <RevisionPicker
                outputId={readabilityOutput.id}
                selectedId={aiRevision?.id ?? null}
                onSelect={(revision) => setAiRevision(revision)}
              />
              <ExportMenu
                document={doc}
                output={readabilityOutput}
                variantLabel="AI Düzenlemesi"
                revisionId={aiRevision?.id}
                onMessage={onNotice}
              />
            </>
          ) : null}
          {effectiveTab === "summary" && summaryOutput ? (
            <>
              <RevisionPicker
                outputId={summaryOutput.id}
                selectedId={summaryRevision?.id ?? null}
                onSelect={(revision) => setSummaryRevision(revision)}
              />
              <ExportMenu
                document={doc}
                output={summaryOutput}
                variantLabel={`Özet ${summaryLevelLabel[summaryLevel]}`}
                revisionId={summaryRevision?.id}
                onMessage={onNotice}
              />
            </>
          ) : null}
        </div>
      </div>

      <div
        id={`panel-${effectiveTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${effectiveTab}`}
        tabIndex={0}
        className="min-w-0"
      >
        {/* Yazdırma: yalnızca bu alan basılır (globals.css @media print) */}
        <div
          id="print-root"
          onClick={onMarkClick}
        >
        {effectiveTab === "original" ? (
          <div className="flex flex-col gap-3">
            {doc.source_type === "url" && doc.original_html ? (
              <HighlightedArticle
                html={doc.original_html}
                annotations={originalAnnotations}
                onLinkedChange={onLinkedChange}
              />
            ) : (
              <div className="article whitespace-pre-wrap">
                <HighlightedText text={doc.original_text} entries={originalEntries} />
              </div>
            )}
            {!editing ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  onTabChange("edited");
                }}
                className="no-print inline-flex min-h-[40px] w-fit items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.04)] hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                <EditIcon size={16} /> Düzenlemeye başla
              </button>
            ) : null}
          </div>
        ) : null}

        {effectiveTab === "edited" ? (
          <div className="flex flex-col gap-4">
            <EditorPanel
              key={doc.id}
              documentId={doc.id}
              edit={detail.edit}
              originalText={doc.original_text}
              onEditChange={(edit) => {
                onEditChange(edit);
                setEditing(false);
              }}
              onNotice={onNotice}
            />
            {compare ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    Orijinal
                  </h3>
                  <div className="article max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-stone-200 p-3 dark:border-stone-800">
                    {doc.original_text}
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    Düzenlenmiş
                  </h3>
                  <div className="article max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-stone-200 p-3 dark:border-stone-800">
                    {detail.edit?.content || "(boş)"}
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCompare(true)}
                className="no-print min-h-[36px] w-fit text-xs text-stone-600 underline underline-offset-2 dark:text-stone-400"
              >
                Orijinal ile karşılaştır
              </button>
            )}
          </div>
        ) : null}

        {effectiveTab === "ai-edit" ? (
          readabilityOutput ? (
            <div className="flex flex-col gap-3">
              <div className="no-print flex justify-end">
                <button
                  type="button"
                  onClick={() => void takeAsEdited(readabilityOutput, aiRevision?.content ?? readabilityOutput.content)}
                  className="min-h-[40px] rounded-md border border-stone-300 px-3 py-2 text-xs text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                  title="Mevcut düzenlemeyi sessizce ezmez; onay sorar"
                >
                  ⇩ Düzenlenmiş sürüme al
                </button>
              </div>
              <MarkdownBlock content={aiRevision?.content ?? readabilityOutput.content} />
            </div>
          ) : (
            <p className="text-sm text-stone-500">Okunabilirlik çalışması kuyrukta — burada görünecek.</p>
          )
        ) : null}

        {effectiveTab === "summary" ? (
          summaryOutput ? (
            <MarkdownBlock content={summaryRevision?.content ?? summaryOutput.content} />
          ) : (
            <p className="text-sm text-stone-500">
              {summaryLevelLabel[summaryLevel]} özet kuyrukta — tamamlandığında burada görünecek.
            </p>
          )
        ) : null}
        </div>
      </div>

      {/* Vurgu popover */}
      {popover
        ? (() => {
            const annotation = annotations.find((candidate) => candidate.id === popover.id);
            if (!annotation) return null;
            return (
              <HighlightPopover
                annotation={annotation}
                position={{ x: popover.x, y: popover.y }}
                onUpdate={(id, patch) => updateAnnotation(id, patch)}
                onRemove={async (id) => removeAnnotation(id)}
                onAsk={(text) => {
                  onAskWithQuote(text);
                  setPopover(null);
                }}
                onOpenNote={(id) => {
                  onFocusNote(id);
                  setPopover(null);
                }}
                onClose={() => setPopover(null)}
              />
            );
          })()
        : null}

      {effectiveTab === "original" ? (
        <SelectionToolbar
          containerSelector={`#panel-original`}
          contentKind="original"
          contentRevision={0}
          fullTextResolver={() => doc.original_text}
          onCreate={async (input) => createAnnotation(input)}
          onNoteCreated={onFocusNote}
          onAskWithQuote={onAskWithQuote}
        />
      ) : null}
    </div>
  );
}
