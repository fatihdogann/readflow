"use client";

import { useRouter } from "next/navigation";
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Bağlantı ekle veya metin yapıştır…"
        rows={isUrl ? 2 : 8}
        className="w-full resize-y rounded-lg border border-stone-300 bg-white px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-stone-400 focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:placeholder:text-stone-500 dark:focus:border-stone-500"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!value.trim() || busy}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {busy ? "Alınıyor…" : "Kaydet"}
        </button>
        {value.trim() ? (
          <span className="text-xs text-stone-500">
            {isUrl ? "🔗 Bağlantı algılandı — sayfa burada indirilip ayrıştırılacak" : "📝 Düz metin olarak kaydedilecek"}
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
