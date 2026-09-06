"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mutateJson } from "@/lib/client/api";
import { createLatestDraftSaver } from "@/lib/client/latestDraftSaver";
import { CloseIcon } from "@/components/Icons";

const MAX_NOTE = 20_000;
const AUTOSAVE_MS = 1500;

/**
 * Kişisel not paneli: tek taslak state'iyle masaüstünde yardımcı sütun,
 * dar ekranda çekmece.
 * Debounce'lu autosave + manuel kayıt; hata durumunda taslak asla silinmez.
 */
export function NotesPanel({
  documentId,
  initialNote,
  initialUpdatedAt,
  open,
  onClose,
}: {
  documentId: number;
  initialNote: string;
  initialUpdatedAt: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialNote);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialUpdatedAt);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (isMobile) document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !isMobile || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [isMobile, open, onClose]);

  const saverRef = useRef<ReturnType<typeof createLatestDraftSaver<string>> | null>(null);
  useEffect(() => {
    saverRef.current = createLatestDraftSaver(
      async (value) => {
        await mutateJson(`/api/documents/${documentId}`, "PATCH", { note: value });
      },
      (next) => {
        if (next.phase === "saving") {
          setSaving(true);
          setStatus("Kaydediliyor…");
          return;
        }
        setSaving(false);
        if (next.phase === "error") {
          setDirty(true);
          setStatus("Kaydedilemedi — taslak korundu");
          return;
        }
        const unchangedSinceRequest = draftRef.current === next.value;
        setDirty(!unchangedSinceRequest);
        setLastSavedAt(new Date().toISOString());
        setStatus(
          unchangedSinceRequest
            ? `Kaydedildi · ${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
            : "Yeni değişiklikler kaydedilmeyi bekliyor…",
        );
      },
    );
    return () => {
      saverRef.current = null;
    };
  }, [documentId]);

  const save = useCallback(async (): Promise<void> => {
    await saverRef.current?.save(draftRef.current);
  }, []);

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

  if (!open) return null;

  const body = (
    <div className="flex h-full flex-col gap-2">
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Not panelini kapat"
            className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <CloseIcon size={18} />
          </button>
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
          rows={12}
          className="w-full flex-1 resize-none rounded-xl border border-stone-300 bg-white px-3.5 py-3 text-sm leading-relaxed shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none transition focus:border-stone-500 focus:ring-2 focus:ring-stone-900/5 dark:border-stone-700 dark:bg-stone-950/40 dark:focus:border-stone-500 dark:focus:ring-white/5"
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

  return (
    <div className="no-print fixed inset-0 z-40 lg:sticky lg:top-6 lg:z-auto lg:h-fit lg:max-h-[calc(100vh-3rem)] lg:w-80 lg:shrink-0">
      <button
        type="button"
        aria-label="Not panelini kapat"
        className="absolute inset-0 bg-stone-950/35 backdrop-blur-[2px] lg:hidden"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal={isMobile || undefined}
        aria-label="Kişisel not"
        className="absolute inset-x-0 bottom-0 flex h-[76vh] flex-col rounded-t-2xl border border-stone-200 bg-[#faf9f7] p-4 shadow-[0_-16px_50px_rgba(28,25,23,0.16)] dark:border-stone-800 dark:bg-[#171512] lg:relative lg:inset-auto lg:h-auto lg:max-h-[calc(100vh-3rem)] lg:rounded-2xl lg:bg-stone-100/70 lg:p-4 lg:shadow-[0_14px_40px_rgba(28,25,23,0.08)] lg:dark:bg-stone-900/55"
      >
        {body}
      </aside>
    </div>
  );
}
