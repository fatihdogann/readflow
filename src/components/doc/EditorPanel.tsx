"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mutateJson } from "@/lib/client/api";
import type { DocumentEditInfo } from "@/lib/documents/service";

export interface EditorPanelProps {
  documentId: number;
  edit: DocumentEditInfo | null;
  originalText: string;
  /** Orijinal/Düzenlenmiş karşılaştırması için. */
  onEditChange: (edit: DocumentEditInfo | null) => void;
  onNotice: (message: string) => void;
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
export function EditorPanel({ documentId, edit, originalText, onEditChange, onNotice }: EditorPanelProps) {
  const [draft, setDraft] = useState(edit?.content ?? originalText);
  const [revision, setRevision] = useState<number | null>(edit?.revision ?? 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState<{ currentContent: string; currentRevision: number } | null>(null);
  const [status, setStatus] = useState<string>("");
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setStatus("Kaydediliyor…");
    try {
      const body = await mutateJson<{ edit: DocumentEditInfo }>(
        `/api/documents/${documentId}/edit`,
        "PUT",
        { content: draft, revision },
      );
      setRevision(body.edit.revision);
      setDirty(false);
      setConflict(null);
      setStatus(`Kaydedildi · ${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, revision, saving]);

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
      <div className="no-print flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setPreview((value) => !value)}
          aria-pressed={preview}
          className="min-h-[36px] rounded border border-stone-300 px-3 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
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
                setConflict(null);
                void save();
              }}
            >
              Taslağımı üzerine yaz
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="article min-h-[200px] rounded-md border border-stone-200 p-4 dark:border-stone-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft || "_Boş_"}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
            setStatus("");
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              if (dirty) void save();
            }
          }}
          rows={16}
          aria-label="Düzenlenmiş metin (kullanıcı sürümü)"
          className="w-full resize-y rounded-md border border-stone-300 bg-white px-4 py-3 font-serif text-[15px] leading-relaxed outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500"
        />
      )}

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
