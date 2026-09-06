"use client";

import { useRouter } from "next/navigation";
import { FileTextIcon, LinkIcon } from "./Icons";
import { useMemo, useState } from "react";
import { looksLikeUrl } from "@/lib/types";

export function NewDocumentForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUrl = useMemo(() => looksLikeUrl(value), [value]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isUrl ? { url: trimmed } : { text: trimmed }),
      });
      const body = (await response.json()) as { id?: number; error?: string };
      if (!response.ok || !body.id) {
        setError(body.error ?? "İçerik kaydedilemedi");
        return;
      }
      router.push(`/doc/${body.id}`);
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white/70 p-3 shadow-[0_16px_45px_rgba(28,25,23,0.07)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none sm:p-4">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Bağlantı ekle veya metin yapıştır…"
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
        {value.trim() ? (
          <span className="text-xs text-stone-500">
            <span className="inline-flex items-center gap-1.5">
              {isUrl ? <LinkIcon size={14} /> : <FileTextIcon size={14} />}
              {isUrl ? "Bağlantı algılandı — sayfa burada indirilip ayrıştırılacak" : "Düz metin olarak kaydedilecek"}
            </span>
          </span>
        ) : (
          <span className="text-xs text-stone-400">
            URL otomatik algılanır; yapıştırdığın her şey yalnızca bu bilgisayarda saklanır.
          </span>
        )}
      </div>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </form>
  );
}
