"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mutateJson } from "@/lib/client/api";
import { createLatestDraftSaver } from "@/lib/client/latestDraftSaver";

const MAX_NOTE = 20_000;
const AUTOSAVE_MS = 1500;

/**
 * Kişisel not içeriği. Kabuk (sütun/alt sayfa, odak tuzağı, Escape) RightRail'e
 * aittir; burada yalnız taslak state'i, debounce'lu autosave ve manuel kayıt var.
 * Hata durumunda taslak asla silinmez.
 */
export function NotesPanel({
  documentId,
  initialNote,
  initialUpdatedAt,
}: {
  documentId: number;
  initialNote: string;
  initialUpdatedAt: string | null;
}) {
  const [draft, setDraft] = useState(initialNote);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialUpdatedAt);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  /**
   * "Ek not": mevcut notu bozmadan altına tarihli yeni blok açar ve imleci
   * oraya taşır. Ayrı tablo yerine tek metin — geçmiş elle de düzenlenebilir.
   */
  function appendEntry(): void {
    const stamp = new Date().toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const block = `${draft.trim() ? `${draft.trimEnd()}\n\n---\n\n` : ""}**${stamp}**\n\n`;
    if (block.length > MAX_NOTE) {
      setStatus("Not sınırına ulaşıldı — ek not eklenemedi");
      return;
    }
    setPreview(false);
    setDraft(block);
    setDirty(true);
    setStatus("");
    setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(block.length, block.length);
      textarea.scrollTop = textarea.scrollHeight;
    }, 0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="min-w-0 truncate text-[11px] text-stone-500 dark:text-stone-400">
          {status ||
            (dirty
              ? "kaydedilmedi"
              : lastSavedAt
                ? `son düzenleme: ${lastSavedAt.slice(0, 16).replace("T", " ")}`
                : "henüz not yok")}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={appendEntry}
            title="Notun altına tarihli yeni bir blok aç"
            className="min-h-[32px] rounded-md border border-stone-300 px-2 text-[11px] text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            + ek not
          </button>
          <button
            type="button"
            onClick={() => setPreview((value) => !value)}
            aria-pressed={preview}
            className="min-h-[32px] rounded px-2 text-[11px] text-stone-600 underline underline-offset-2 dark:text-stone-400"
          >
            {preview ? "Düzenle" : "Önizle"}
          </button>
        </div>
      </div>

      {preview ? (
        <div className="article min-h-[140px] flex-1 overflow-y-auto rounded-md border border-stone-200 p-3 text-sm dark:border-stone-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft || "_Boş_"}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            if (event.target.value.length > MAX_NOTE) return;
            setDraft(event.target.value);
            setDirty(true);
            setStatus("");
          }}
          aria-label="Kişisel not (otomatik kaydedilir)"
          rows={12}
          className="w-full min-h-[200px] flex-1 resize-none rounded-xl border border-stone-300 bg-white px-3.5 py-3 text-sm leading-relaxed shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none transition focus:border-stone-500 focus:ring-2 focus:ring-stone-900/5 dark:border-stone-700 dark:bg-stone-950/40 dark:focus:border-stone-500 dark:focus:ring-white/5"
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
}
