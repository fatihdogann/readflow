export const metadata = { title: "Çevrimdışı · Readflow" };

/** Ağ yokken ve sayfa önbellekte de yokken gösterilir (service worker yedeği). */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-[-0.025em]">Çevrimdışısın</h1>
      <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-400">
        Bu sayfa daha önce açılmadığı için önbellekte yok. Daha önce açtığın belgeler
        çevrimdışı okunabilir. Bağlantı gelince yeni içerik eklenebilir ve AI işleri çalışır.
      </p>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Mac uykudaysa veya Tailscale bağlı değilse uygulama sunucusuna ulaşılamaz.
      </p>
    </div>
  );
}
