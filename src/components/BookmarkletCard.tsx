"use client";

import { useEffect, useState } from "react";

/**
 * "Readflow'a gönder" bookmarklet'i.
 *
 * Bağlantı token içerir; yer imi olarak kaydedilir, tıklanınca açık sekmenin
 * HTML'ini Readflow'a yollar. Sunucunun sayfayı indirmesi gerekmediği için
 * bot koruması, paywall ve JS ile üretilen sayfalar da eklenebilir.
 */
export function BookmarkletCard() {
  const [href, setHref] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState<{ ingestUrl: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/bookmarklet", { cache: "no-store" });
        if (!response.ok) {
          setError("Bookmarklet oluşturulamadı (oturum gerekli olabilir)");
          return;
        }
        const body = (await response.json()) as { href: string; ingestUrl: string; token: string };
        setHref(body.href);
        setShortcut({ ingestUrl: body.ingestUrl, token: body.token });
      } catch {
        setError("Sunucuya ulaşılamadı");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function copy(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section
      aria-labelledby="bookmarklet-heading"
      className="rounded-2xl border border-stone-200 bg-white/70 p-4 shadow-[0_12px_34px_rgba(28,25,23,0.045)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none sm:p-5"
    >
      <h2 id="bookmarklet-heading" className="text-sm font-semibold">
        Tarayıcıdan gönder
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
        Aşağıdaki bağlantıyı <strong>yer imleri çubuğuna sürükle</strong>. Bir sayfayı okurken
        tıkladığında sayfanın kaynağı doğrudan Readflow&apos;a gider — sunucu siteye hiç istek
        atmaz. Bot koruması veren, oturum isteyen veya içeriğini JavaScript ile üreten
        sayfalar bu yolla eklenir.
      </p>

      {href ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={href}
            onClick={(event) => event.preventDefault()}
            draggable
            title="Yer imleri çubuğuna sürükle"
            className="inline-flex cursor-grab items-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-[0_5px_16px_rgba(28,25,23,0.16)] active:cursor-grabbing dark:bg-stone-100 dark:text-stone-900 dark:shadow-none"
          >
            ↗ Readflow&apos;a gönder
          </a>
          <span className="text-[11px] text-stone-500 dark:text-stone-400">
            iOS Safari&apos;de: bağlantıyı kopyala, herhangi bir sayfayı yer imine ekle, yer iminin
            adresini bununla değiştir.
          </span>
        </div>
      ) : (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">{error ?? "Hazırlanıyor…"}</p>
      )}

      {shortcut ? (
        <details className="mt-3 rounded-xl border border-stone-200 p-3 text-xs dark:border-stone-800">
          <summary className="cursor-pointer font-medium">iPhone paylaşım menüsü (Kestirmeler)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed text-stone-600 dark:text-stone-400">
            <li>Kestirmeler → <strong>+</strong> → adı &quot;Readflow&apos;a gönder&quot;.</li>
            <li>
              Ayrıntılar (ⓘ) → <strong>Paylaşma Sayfasında Göster</strong> açık; girdi türleri: URL&apos;ler ve
              Metin.
            </li>
            <li>
              Eylem: <strong>URL&apos;nin İçeriğini Al</strong> → URL: aşağıdaki adres, Yöntem: POST.
            </li>
            <li>
              Başlıklar: <code>Authorization</code> = <code>Bearer</code> + boşluk + token.
            </li>
            <li>
              İstek Gövdesi: JSON → anahtar <code>text</code>, değer: <strong>Kestirme Girdisi</strong>.
            </li>
            <li>Telefonda Tailscale açıkken Safari&apos;de Paylaş → Readflow&apos;a gönder.</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copy("adres", shortcut.ingestUrl)}
              className="min-h-9 rounded-lg border border-stone-300 px-3 dark:border-stone-700"
            >
              Adresi kopyala
            </button>
            <button
              type="button"
              onClick={() => copy("token", `Bearer ${shortcut.token}`)}
              className="min-h-9 rounded-lg border border-stone-300 px-3 dark:border-stone-700"
            >
              &quot;Bearer token&quot; kopyala
            </button>
            <span role="status" className="self-center text-stone-500">
              {copied ? `${copied} kopyalandı` : ""}
            </span>
          </div>
          <p className="mt-2 break-all text-[11px] text-stone-500">{shortcut.ingestUrl}</p>
        </details>
      ) : null}

      <p className="mt-3 border-t border-stone-200 pt-2 text-[11px] text-stone-500 dark:border-stone-800 dark:text-stone-400">
        Bağlantı bir erişim token&apos;ı taşır — yalnızca &quot;doküman ekle&quot; yetkisi verir.
        Paylaşma; yer imini silmek yetkiyi kaldırmaz, gerekiyorsa sunucudaki
        <code className="mx-1 rounded bg-stone-200/70 px-1 dark:bg-stone-800">ingest_token</code>
        kaydını temizle.
      </p>
    </section>
  );
}
