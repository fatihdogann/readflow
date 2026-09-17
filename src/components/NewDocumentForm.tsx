"use client";

import { useRouter } from "next/navigation";
import { FileTextIcon, LinkIcon } from "./Icons";
import { useMemo, useRef, useState } from "react";
import { looksLikeUrl } from "@/lib/types";

const ACCEPTED = ".pdf,.docx,.md,.markdown,.txt,.csv";

export function NewDocumentForm({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // URL engellendiğinde açılan kaçış yolu: sayfanın kaynağını elle yapıştır.
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pastedHtml, setPastedHtml] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const isUrl = useMemo(() => looksLikeUrl(value), [value]);

  async function open(response: Response): Promise<void> {
    const body = (await response.json()) as { id?: number; error?: string };
    if (!response.ok || !body.id) throw new Error(body.error ?? "İçerik kaydedilemedi");
    router.push(`/doc/${body.id}`);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setPasteFor(null);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isUrl ? { url: trimmed } : { text: trimmed }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "İçerik kaydedilemedi");
        // Site bizi engellediyse kullanıcı sayfayı kendi tarayıcısından getirebilir.
        if (isUrl) setPasteFor(trimmed);
        return;
      }
      await open(response);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Sunucuya ulaşılamadı");
    } finally {
      setBusy(false);
    }
  }

  async function submitHtml(): Promise<void> {
    const html = pastedHtml.trim();
    if (!html || busy) return;
    setBusy(true);
    setError(null);
    try {
      await open(
        await fetch("/api/documents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ html, sourceUrl: pasteFor ?? undefined }),
        }),
      );
    } catch (htmlError) {
      setError(htmlError instanceof Error ? htmlError.message : "Sayfa kaynağı işlenemedi");
    } finally {
      setBusy(false);
    }
  }

  function upload(file: File): Promise<Response> {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/documents", { method: "POST", body: form });
  }

  /** Tek dosya: belgeyi açar. Birden fazla: sırayla ekler, özet gösterir. */
  async function submitFiles(files: File[]): Promise<void> {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPasteFor(null);
    try {
      if (files.length === 1) {
        await open(await upload(files[0]));
        return;
      }
      const failed: string[] = [];
      for (const [index, file] of files.entries()) {
        setNotice(`${index + 1}/${files.length}: ${file.name}`);
        const response = await upload(file).catch(() => null);
        if (!response?.ok) failed.push(file.name);
      }
      setNotice(`${files.length - failed.length} belge eklendi.`);
      if (failed.length) setError(`Eklenemeyen: ${failed.join(", ")}`);
      router.refresh();
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Dosya işlenemedi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void submitFiles(Array.from(event.dataTransfer.files));
      }}
      className={`flex flex-col gap-3 rounded-2xl border bg-white/70 p-3 shadow-[0_16px_45px_rgba(28,25,23,0.07)] transition dark:bg-stone-900/35 dark:shadow-none sm:p-4 ${
        dragging
          ? "border-stone-500 bg-stone-100/80 dark:border-stone-500"
          : "border-stone-200 dark:border-stone-800"
      }`}
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Bağlantı ekle, metin yapıştır veya dosya bırak…"
        rows={isUrl ? 2 : 8}
        className="w-full resize-y rounded-xl border-0 bg-transparent px-2 py-2 text-[15px] leading-relaxed outline-none placeholder:text-stone-400 focus:ring-0 dark:placeholder:text-stone-500"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!value.trim() || busy}
          className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-[0_5px_16px_rgba(28,25,23,0.16)] transition hover:-translate-y-px hover:bg-stone-700 disabled:translate-y-0 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:shadow-none dark:hover:bg-white"
        >
          {busy ? "Alınıyor…" : "Kaydet"}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="rounded-xl border border-stone-300 px-3 py-2.5 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          Dosya seç
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED}
          multiple
          className="sr-only"
          aria-label="PDF, Word veya metin dosyaları"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void submitFiles(files);
          }}
        />
        {value.trim() ? (
          <span className="text-xs text-stone-500">
            <span className="inline-flex items-center gap-1.5">
              {isUrl ? <LinkIcon size={14} /> : <FileTextIcon size={14} />}
              {isUrl ? "Bağlantı algılandı — sayfa burada indirilip ayrıştırılacak" : "Düz metin olarak kaydedilecek"}
            </span>
          </span>
        ) : (
          <span className="text-xs text-stone-400">
            PDF · Word · Markdown sürükleyebilirsin (birden fazla da olur). Her şey yalnızca bu bilgisayarda saklanır.
          </span>
        )}
      </div>

      {notice ? (
        <p role="status" className="text-sm text-stone-600 dark:text-stone-400">
          {notice}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {pasteFor ? (
        <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900/50">
          <p className="text-xs text-stone-600 dark:text-stone-400">
            Sayfayı tarayıcında aç, <strong>sağ tık → Sayfa kaynağını görüntüle</strong> (veya ⌘/Ctrl+U),
            tümünü kopyalayıp buraya yapıştır. Oturum ve bot koruması senin tarayıcında zaten çözülü.
          </p>
          <textarea
            value={pastedHtml}
            onChange={(event) => setPastedHtml(event.target.value)}
            rows={4}
            placeholder="<!doctype html>…"
            aria-label="Sayfa kaynağı (HTML)"
            className="w-full resize-y rounded-lg border border-stone-300 bg-white px-2.5 py-2 font-mono text-[11px] outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950/40"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submitHtml()}
              disabled={!pastedHtml.trim() || busy}
              className="min-h-[36px] rounded-lg bg-stone-900 px-3 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
            >
              Kaynaktan ekle
            </button>
            <button
              type="button"
              onClick={() => {
                setPasteFor(null);
                setPastedHtml("");
              }}
              className="min-h-[36px] rounded-lg px-3 text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
