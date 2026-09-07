"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mutateJson } from "@/lib/client/api";
import type { DocumentEditInfo } from "@/lib/documents/service";
import {
  HighlightedMarkdown,
  HighlightPopover,
  SelectionToolbar,
  type UseAnnotations,
} from "./Highlights";

export interface EditorPanelProps {
  documentId: number;
  edit: DocumentEditInfo | null;
  originalText: string;
  /** Orijinal/Düzenlenmiş karşılaştırması için. */
  onEditChange: (edit: DocumentEditInfo | null) => void;
  onNotice: (message: string) => void;
  /** Bu sürüme ait vurgular — yalnız önizlemede gösterilir (textarea'ya işaret konamaz). */
  annotations: UseAnnotations;
  onLinkedChange: (linkedIds: number[]) => void;
  onFocusNote: (annotationId: number) => void;
  onAskWithQuote: (quote: string) => void;
}

function countWords(text: string): number {
  const tokens = text.trim().match(/[\p{L}\p{N}']+/gu);
  return tokens ? tokens.length : 0;
}

/**
 * Kullanıcı sürümü editörü: orijinali asla değiştirmez, ayrı revision'lı
 * kayıt yapar. 409 çakışmasında taslak korunur ve kullanıcıya yeniden
 * yükleme seçeneği sunulur.
 */
export function EditorPanel({
  documentId,
  edit,
  originalText,
  onEditChange,
  onNotice,
  annotations: annotationStore,
  onLinkedChange,
  onFocusNote,
  onAskWithQuote,
}: EditorPanelProps) {
  const [draft, setDraft] = useState(edit?.content ?? originalText);
  const [revision, setRevision] = useState<number | null>(edit?.revision ?? 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState<{ currentContent: string; currentRevision: number } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [popover, setPopover] = useState<{ id: number; x: number; y: number } | null>(null);

  const editedAnnotations = useMemo(
    () => annotationStore.annotations.filter((item) => item.content_kind === "edited"),
    [annotationStore.annotations],
  );

  const onMarkClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName !== "MARK" || !target.id.startsWith("ann-")) return;
      const id = Number(target.id.slice(4));
      if (!editedAnnotations.some((candidate) => candidate.id === id)) return;
      const rect = target.getBoundingClientRect();
      setPopover({ id, x: rect.left, y: rect.bottom + 6 });
    },
    [editedAnnotations],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirtyRef = useRef(dirty);
  const draftRef = useRef(draft);
  const revisionRef = useRef(revision);
  const savingRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    if (dirtyRef.current) return;
    const nextDraft = edit?.content ?? originalText;
    setDraft(nextDraft);
    setRevision(edit?.revision ?? 0);
  }, [edit, originalText]);

  useEffect(() => {
    if (preview || !textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 520)}px`;
  }, [draft, preview]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  async function save(overrides?: { content?: string; revision?: number | null }): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setStatus("Kaydediliyor…");
    const submittedContent = overrides?.content ?? draftRef.current;
    const submittedRevision = overrides?.revision ?? revisionRef.current;
    try {
      const body = await mutateJson<{ edit: DocumentEditInfo }>(
        `/api/documents/${documentId}/edit`,
        "PUT",
        { content: submittedContent, revision: submittedRevision },
      );
      setRevision(body.edit.revision);
      const unchangedSinceRequest = draftRef.current === submittedContent;
      setDirty(!unchangedSinceRequest);
      setConflict(null);
      setStatus(
        unchangedSinceRequest
          ? `Kaydedildi · ${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
          : "Yeni değişiklikler kaydedilmeyi bekliyor…",
      );
      onEditChange(body.edit);
      onNotice("");
    } catch (error) {
      const apiError = error as Error & { status?: number; body?: { currentRevision?: number; currentContent?: string } };
      if (apiError.status === 409) {
        setConflict({
          currentContent: apiError.body?.currentContent ?? "",
          currentRevision: apiError.body?.currentRevision ?? 0,
        });
        setStatus("Sürüm çakışması — taslağın aşağıda korundu");
      } else {
        setStatus("Kaydedilemedi — taslak korundu");
        onNotice(apiError.message);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `save` ref'lerden güncel taslak/revision okur; listener yalnız kayıt durumuna bağlıdır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  async function removeEdit(): Promise<void> {
    try {
      await mutateJson(`/api/documents/${documentId}/edit`, "DELETE");
      setDraft(originalText);
      setRevision(0);
      setDirty(false);
      onEditChange(null);
      setStatus("Kullanıcı sürümü kaldırıldı");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Kaldırılamadı");
    }
  }

  const words = countWords(draft);

  return (
    <div className="flex flex-col gap-3">
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-stone-200 pb-3 text-xs dark:border-stone-800">
        <button
          type="button"
          onClick={() => setPreview((value) => !value)}
          aria-pressed={preview}
          className="min-h-[36px] rounded-lg border border-stone-300 bg-white px-3 text-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.04)] hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          {preview ? "Düzenle" : "Önizle"}
        </button>
        <span className="text-stone-500 dark:text-stone-400" aria-live="polite" role="status">
          {words} kelime · {draft.length} karakter · {status || (dirty ? "kaydedilmedi" : "kayıtlı")}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("İçerik, orijinal metinle yeniden oluşturulsun mu? Mevcut taslak değişir.")) {
                setDraft(originalText);
                setDirty(true);
              }
            }}
            className="min-h-[36px] rounded px-2 text-stone-600 underline underline-offset-2 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          >
            Orijinalden yeniden oluştur
          </button>
          {edit ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Kayıtlı kullanıcı sürümü kaldırılsın mı? Bu işlem geri alınamaz.")) {
                  void removeEdit();
                }
              }}
              className="min-h-[36px] rounded px-2 text-stone-600 underline underline-offset-2 hover:text-red-600 dark:text-stone-400"
            >
              Sürümü kaldır
            </button>
          ) : null}
        </span>
      </div>

      {conflict ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
          <p className="font-medium">Başka bir kayıt belgeyi güncelledi (sunucudaki sürüm {conflict.currentRevision}).</p>
          <p className="mt-1">Taslağın kaybolmadı. Ne yapmak istersin?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="min-h-[36px] rounded bg-stone-900 px-3 py-1 text-white dark:bg-stone-100 dark:text-stone-900"
              onClick={() => {
                setDraft(conflict.currentContent);
                setRevision(conflict.currentRevision);
                setDirty(true);
                setConflict(null);
              }}
            >
              Sunucudaki sürümü yükle
            </button>
            <button
              type="button"
              className="min-h-[36px] rounded border border-stone-300 px-3 py-1 dark:border-stone-700"
              onClick={() => {
                setRevision(conflict.currentRevision);
                void save({ revision: conflict.currentRevision });
              }}
            >
              Taslağımı üzerine yaz
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div
          id="edited-preview"
          className="min-h-[200px] rounded-md border border-stone-200 p-4 dark:border-stone-800"
          onClick={onMarkClick}
        >
          <HighlightedMarkdown
            markdown={draft || "_Boş_"}
            annotations={editedAnnotations}
            onLinkedChange={onLinkedChange}
          />
        </div>
      ) : (
        <div className="relative -mx-3 rounded-2xl bg-white px-3 py-2 shadow-[0_14px_45px_rgba(28,25,23,0.06)] ring-1 ring-stone-200/80 dark:bg-stone-950/30 dark:shadow-none dark:ring-stone-800/80 sm:mx-0 sm:px-8 sm:py-7">
          <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
            setStatus("");
          }}
          rows={1}
          spellCheck
          aria-label="Düzenlenmiş metin (kullanıcı sürümü)"
          className="article w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-stone-800 outline-none placeholder:text-stone-400 focus:ring-0 dark:text-stone-200"
        />
          <div className="pointer-events-none absolute inset-y-8 left-3 w-px bg-stone-200/80 dark:bg-stone-800 sm:left-5" aria-hidden />
        </div>
      )}

      {preview ? (
        <SelectionToolbar
          containerSelector="#edited-preview"
          contentKind="edited"
          contentRevision={edit?.revision ?? 0}
          fullTextResolver={() => draftRef.current}
          onCreate={(input) => annotationStore.create(input)}
          onNoteCreated={onFocusNote}
          onAskWithQuote={onAskWithQuote}
        />
      ) : null}

      {popover
        ? (() => {
            const annotation = editedAnnotations.find((candidate) => candidate.id === popover.id);
            if (!annotation) return null;
            return (
              <HighlightPopover
                annotation={annotation}
                position={popover}
                onUpdate={(id, patch) => annotationStore.update(id, patch)}
                onRemove={(id) => annotationStore.remove(id)}
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

      <div className="no-print flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="min-h-[40px] rounded-md bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {saving ? "Kaydediliyor…" : "Kaydet (⌘/Ctrl+S)"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setDraft(edit?.content ?? originalText);
              setRevision(edit?.revision ?? 0);
              setDirty(false);
              setStatus("");
            }}
            className="min-h-[40px] rounded-md border border-stone-300 px-4 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            İptal
          </button>
        ) : null}
      </div>
    </div>
  );
}
