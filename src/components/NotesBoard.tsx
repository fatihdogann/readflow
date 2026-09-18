"use client";

import { useRef, useState } from "react";
import type { FolderRow } from "@/lib/db/repo/folders";
import type { NoteRow } from "@/lib/db/repo/notes";
import { mutateJson } from "@/lib/client/api";
import { notifyFoldersChanged } from "@/lib/client/events";

const HOLD_MS = 500;

export function NotesBoard({ initialNotes, folders }: { initialNotes: NoteRow[]; folders: FolderRow[] }) {
  const [notes, setNotes] = useState(initialNotes);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState("");
  const [active, setActive] = useState<NoteRow | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function replace(next: NoteRow): void {
    setNotes((current) => current.map((note) => (note.id === next.id ? next : note)));
    setActive(next);
  }

  function clearHold(): void {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
  }

  async function create(): Promise<void> {
    setError(null);
    try {
      const body = await mutateJson<{ note: NoteRow }>("/api/notes", "POST", { title, content, folderId: folderId ? Number(folderId) : null });
      setNotes((current) => [body.note, ...current]);
      notifyFoldersChanged();
      setTitle(""); setContent(""); setFolderId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not kaydedilemedi");
    }
  }

  async function move(nextFolderId: string): Promise<void> {
    if (!active) return;
    try {
      const body = await mutateJson<{ note: NoteRow }>(`/api/notes/${active.id}`, "PATCH", { folderId: nextFolderId ? Number(nextFolderId) : null });
      replace(body.note);
      notifyFoldersChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Klasör güncellenemedi");
    }
  }

  async function addTag(): Promise<void> {
    if (!active || !tagInput.trim()) return;
    try {
      const body = await mutateJson<{ note: NoteRow }>(`/api/notes/${active.id}/tags`, "PUT", { tags: [...active.tags, tagInput] });
      setTagInput(""); replace(body.note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Etiket kaydedilemedi");
    }
  }

  return <div className="flex flex-col gap-5">
    <section className="rounded-xl border border-stone-200 bg-white/55 p-4 dark:border-stone-800 dark:bg-stone-900/25">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]"><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Not başlığı" placeholder="Not başlığı" className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-900" /><select value={folderId} onChange={(event) => setFolderId(event.target.value)} aria-label="Klasör" className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-900"><option value="">Klasörsüz</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} aria-label="Not içeriği" placeholder="Düşünceni yaz…" rows={5} className="mt-3 min-h-[140px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm dark:border-stone-700 dark:bg-stone-900" />
      <button type="button" onClick={() => void create()} disabled={!title.trim() || !content.trim()} className="mt-3 min-h-[44px] rounded-lg bg-stone-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">Notu kaydet</button>
    </section>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    {notes.length === 0 ? <p className="rounded-lg border border-dashed border-stone-300 px-5 py-10 text-center text-sm text-stone-500">Henüz bağımsız not yok.</p> : null}
    <div className="grid gap-3">{notes.map((note) => {
      const folder = folders.find((candidate) => candidate.id === note.folder_id);
      return <article key={note.id} aria-label={note.title} onPointerDown={(event) => { if (event.pointerType === "touch") holdRef.current = setTimeout(() => setActive(note), HOLD_MS); }} onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold} className="rounded-xl border border-stone-200 bg-white/55 p-4 dark:border-stone-800 dark:bg-stone-900/25">
        <div className="flex items-start justify-between gap-3"><h2 className="font-medium">{note.title}</h2><button type="button" onClick={() => setActive(note)} aria-label={`${note.title} işlemleri`} className="min-h-[40px] rounded-md px-3 text-xs text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">İşlemler</button></div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">{note.content}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-stone-500">{folder ? <span className="rounded-full bg-stone-200 px-2 py-1 dark:bg-stone-700">{folder.name}</span> : null}{note.tags.map((tag) => <span key={tag} className="rounded-full bg-stone-200 px-2 py-1 dark:bg-stone-700">{tag}</span>)}</div>
      </article>;
    })}</div>
    {active ? <div role="dialog" aria-modal="true" aria-label="Not işlemleri" className="fixed inset-0 z-50 flex items-end bg-black/30 p-3 sm:items-center sm:justify-center" onClick={() => setActive(null)}><section className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl dark:bg-stone-900" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between gap-3"><h2 className="font-medium">{active.title}</h2><button type="button" onClick={() => setActive(null)} aria-label="Not işlemlerini kapat" className="min-h-[40px] px-3 text-sm">Kapat</button></div><label className="mt-4 block text-xs text-stone-600 dark:text-stone-300">Klasör<select value={active.folder_id ?? ""} onChange={(event) => void move(event.target.value)} aria-label="Klasör" className="mt-1 min-h-[44px] w-full rounded-lg border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">Klasörsüz</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><div className="mt-4 flex gap-2"><input value={tagInput} onChange={(event) => setTagInput(event.target.value)} aria-label="Etiket ekle" placeholder="Etiket" className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /><button type="button" onClick={() => void addTag()} className="min-h-[44px] rounded-lg border border-stone-300 px-3 text-sm dark:border-stone-700">Etiketi ekle</button></div></section></div> : null}
  </div>;
}
