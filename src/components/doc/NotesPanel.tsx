"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mutateJson } from "@/lib/client/api";

const MAX_NOTE = 20_000;
const AUTOSAVE_MS = 1500;

/**
 * Kişisel not paneli: masaüstünde yardımcı sütun, dar ekranda çekmece.
 * Debounce'lu autosave + manuel kayıt; hata durumunda taslak asla silinmez.
 */
export function NotesPanel({
  documentId,
  initialNote,
  initialUpdatedAt,
  mode,
  open,
  onClose,
}: {
  documentId: number;
  initialNote: string;
  initialUpdatedAt: string | null;
  mode: "panel" | "drawer";
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialNote);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialUpdatedAt);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const savedDraftRef = useRef(initialNote);
  const panelRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (mode !== "drawer" || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, open, onClose]);

  const savingRef = useRef(false);

  const save = useCallback(async (): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setStatus("Kaydediliyor…");
    try {
      await mutateJson(`/api/documents/${documentId}`, "PATCH", { note: draftRef.current });
      savedDraftRef.current = draftRef.current;
      setDirty(false);
      const time = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      setLastSavedAt(new Date().toISOString());
      setStatus(`Kaydedildi · ${time}`);
    } catch {
      // Taslak textarea'da kalır; dirty korunur.
      setStatus("Kaydedilemedi — taslak korundu");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [documentId]);

  // Debounce'lu autosave
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, save]);

  // Cmd/Ctrl+S
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (mode === "drawer" && !open) return null;

  const body = (
    <div ref={panelRef} className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
          Kişisel Not
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreview((value) => !value)}
            aria-pressed={preview}
            className="min-h-[32px] rounded px-2 text-[11px] text-stone-600 underline underline-offset-2 dark:text-stone-400"
          >
            {preview ? "Düzenle" : "Önizle"}
          </button>
          {mode === "drawer" ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Not panelini kapat"
              className="flex h-9 w-9 items-center justify-center rounded hover:bg-stone-200/60 dark:hover:bg-stone-800"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <p role="status" aria-live="polite" className="text-[11px] text-stone-500 dark:text-stone-400">
        {status ||
          (dirty
            ? "kaydedilmedi"
            : lastSavedAt
              ? `son düzenleme: ${lastSavedAt.slice(0, 16).replace("T", " ")}`
              : "henüz not yok")}
      </p>

      {preview ? (
        <div className="article min-h-[140px] flex-1 overflow-y-auto rounded-md border border-stone-200 p-3 text-sm dark:border-stone-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft || "_Boş_"}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={(event) => {
            if (event.target.value.length > MAX_NOTE) return;
            setDraft(event.target.value);
            setDirty(true);
            setStatus("");
          }}
          aria-label="Kişisel not (otomatik kaydedilir)"
          rows={mode === "panel" ? 12 : 8}
          className="w-full flex-1 resize-none rounded-md border border-stone-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500"
        />
      )}

      <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400">
        <span>
          {draft.length}/{MAX_NOTE}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="min-h-[36px] rounded-md bg-stone-900 px-3 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {saving ? "Kaydediliyor…" : "Kaydet (⌘/Ctrl+S)"}
        </button>
      </div>
    </div>
  );

  if (mode === "drawer") {
    return (
      <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Kişisel not">
        <button type="button" aria-label="Kapat" className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="absolute bottom-0 left-0 right-0 flex h-[70vh] flex-col rounded-t-xl border border-stone-200 bg-[#faf9f7] p-4 dark:border-stone-800 dark:bg-[#171512]">
          {body}
        </div>
      </div>
    );
  }

  if (!open) return null;
  return (
    <aside
      className="no-print sticky top-6 hidden h-fit max-h-[calc(100vh-3rem)] w-72 shrink-0 flex-col rounded-lg border border-stone-200 bg-stone-100/60 p-3 dark:border-stone-800 dark:bg-stone-900/40 lg:flex"
      aria-label="Kişisel not paneli"
    >
      {body}
    </aside>
  );
}
