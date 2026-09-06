"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FolderRow } from "@/lib/db/repo/folders";
import type { DocumentDetail } from "@/lib/documents/service";
import { mutateJson } from "@/lib/client/api";
import { formatAuthorByline } from "@/lib/text/author";
import { NoteIcon, StarIcon } from "@/components/Icons";
import { notifyFoldersChanged } from "@/lib/client/events";

export function DocHeader({
  detail,
  folders,
  onChange,
  onNotesToggle,
  notesOpen,
}: {
  detail: DocumentDetail;
  folders: FolderRow[];
  onChange: (next: DocumentDetail) => void;
  onNotesToggle: () => void;
  notesOpen: boolean;
}) {
  const router = useRouter();
  const doc = detail.document;
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    try {
      const next = await mutateJson<DocumentDetail>(`/api/documents/${doc.id}`, "PATCH", body);
      onChange(next);
      if ("folderId" in body) notifyFoldersChanged();
      return true;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Kaydedilemedi");
      return false;
    }
  }

  async function saveTags(next: string[]): Promise<void> {
    setError(null);
    try {
      const body = await mutateJson<{ tags: string[] }>(`/api/documents/${doc.id}/tags`, "PUT", {
        tags: next,
      });
      onChange({ ...detail, tags: body.tags });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Etiket kaydedilemedi");
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm("Bu doküman ve tüm çıktıları silinsin mi?")) return;
    setError(null);
    try {
      await mutateJson(`/api/documents/${doc.id}`, "DELETE");
      notifyFoldersChanged();
      router.push("/history");
    } catch (mutationError) {
      // Silme başarılı olmadan yönlendirme yapılmaz.
      setError(mutationError instanceof Error ? mutationError.message : "Silinemedi");
    }
  }

  const metaParts: string[] = [];
  if (doc.author) metaParts.push(formatAuthorByline(doc.author));
  if (doc.published_at) metaParts.push(`Yayın: ${doc.published_at.slice(0, 10)}`);
  metaParts.push(`Arşiv: ${doc.created_at.slice(0, 10)}`);

  return (
    <header className="flex flex-col gap-4 border-b border-stone-200 pb-5 dark:border-stone-800">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <h1 className="min-w-0 max-w-[28ch] text-2xl font-semibold leading-[1.18] tracking-[-0.028em] md:text-3xl">
          {doc.title}
        </h1>
        <div className="no-print flex shrink-0 items-center gap-1 sm:pt-0.5">
          <button
            type="button"
            onClick={() => void patch({ favorite: doc.favorite === 0 })}
            className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-stone-200/70 dark:hover:bg-stone-800"
            title={doc.favorite ? "Favoriden çıkar" : "Favoriye ekle"}
            aria-pressed={doc.favorite === 1}
            aria-label={doc.favorite ? "Favoriden çıkar" : "Favoriye ekle"}
          >
            <StarIcon filled={doc.favorite === 1} className={doc.favorite ? "text-amber-500" : "text-stone-400"} />
          </button>
          <button
            type="button"
            onClick={() => void onNotesToggle()}
            aria-expanded={notesOpen}
            className={`flex h-10 min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm hover:bg-stone-200/70 dark:hover:bg-stone-800 ${
              notesOpen ? "bg-stone-200/80 font-medium dark:bg-stone-800" : "text-stone-600 dark:text-stone-300"
            }`}
            title="Kişisel notu aç/kapat"
          >
            <NoteIcon size={16} /> Not
            {doc.note ? <span className="text-[10px] text-amber-600 dark:text-amber-400" aria-hidden>●</span> : null}
          </button>
          <details className="group relative">
            <summary className="flex h-10 cursor-pointer list-none items-center rounded-lg px-3 text-sm text-stone-500 marker:hidden hover:bg-stone-200/70 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100">
              Diğer
            </summary>
            <div className="absolute right-0 top-11 z-20 min-w-36 rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_14px_38px_rgba(28,25,23,0.14)] dark:border-stone-700 dark:bg-stone-900">
              <button
                type="button"
                onClick={() => void remove()}
                className="flex min-h-[38px] w-full items-center rounded-lg px-3 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Dokümanı sil
              </button>
            </div>
          </details>
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-stone-600 dark:text-stone-400">
        {doc.source_url ? (
          <a
            href={doc.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {doc.source_domain ?? doc.source_url}
          </a>
        ) : (
          <span>Yapıştırılan metin</span>
        )}
        {metaParts.map((part, index) => (
          <span key={index} className="flex items-center gap-3">
            {index === 0 && doc.source_url ? <span className="hidden sm:inline" aria-hidden>·</span> : null}
            {index > 0 ? <span className="hidden sm:inline" aria-hidden>·</span> : null}
            {part}
          </span>
        ))}
        <label className="flex min-h-[32px] items-center gap-1 sm:ml-auto">
          <span>Klasör:</span>
          <select
            value={doc.folder_id === null ? "" : String(doc.folder_id)}
            onChange={(event) =>
              void patch({ folderId: event.target.value === "" ? null : Number(event.target.value) })
            }
            className="rounded border border-stone-300 bg-white px-1.5 py-1 text-xs outline-none dark:border-stone-700 dark:bg-stone-900"
          >
            <option value="">Klasörsüz</option>
            {folders.map((folder) => (
              <option key={folder.id} value={String(folder.id)}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="no-print flex flex-wrap items-center gap-1.5">
        {detail.tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-stone-200/80 px-2.5 py-1 text-xs text-stone-600 dark:bg-stone-700/70 dark:text-stone-300"
          >
            {tag}
            <button
              type="button"
              className="text-stone-500 hover:text-red-500"
              onClick={() => void saveTags(detail.tags.filter((candidate) => candidate !== tag))}
              aria-label={`${tag} etiketini kaldır`}
            >
              ×
            </button>
          </span>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = tagInput.trim();
            if (!value) return;
            setTagInput("");
            void saveTags([...detail.tags, value]);
          }}
        >
          <input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            placeholder="+ etiket"
            aria-label="Etiket ekle"
            className="w-28 rounded-full border border-dashed border-stone-300 bg-transparent px-2.5 py-1 text-xs outline-none placeholder:text-stone-500 focus:border-stone-500 dark:border-stone-700 dark:placeholder:text-stone-400"
          />
        </form>
        <Link
          href="/settings"
          className="ml-auto rounded border border-stone-300 px-2 py-1 text-[11px] text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
        >
          AI ayarları
        </Link>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </header>
  );
}
