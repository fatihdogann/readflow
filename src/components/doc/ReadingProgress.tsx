"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "readflow:pos:";
/** Bu oranın altındaki ilerleme "kaldığın yer" sayılmaz (yanlışlıkla kaydırma). */
const MIN_RESUME_RATIO = 0.05;
/** Sona bu kadar yaklaşınca konum unutulur: bitmiş yazı baştan açılsın. */
const FINISHED_RATIO = 0.97;

/**
 * Okuma ilerlemesi: üstte ince çubuk + "kaldığın yere dön".
 *
 * Konum yalnızca bu tarayıcıda `localStorage`'da durur; sunucuya yazmaya değecek
 * bir veri değil. Depolama erişilemezse (gizli sekme, site verisi kapalı)
 * bileşen sessizce yalnız ilerleme çubuğuna düşer.
 */
export function ReadingProgress({
  documentId,
  onStarted,
}: {
  documentId: number;
  /** İlk anlamlı ilerlemede bir kez çağrılır ("okunacak" → "okuyorum"). */
  onStarted?: () => void;
}) {
  const [ratio, setRatio] = useState(0);
  const [resumeTo, setResumeTo] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const onStartedRef = useRef(onStarted);
  useEffect(() => {
    onStartedRef.current = onStarted;
  }, [onStarted]);

  useEffect(() => {
    const key = `${STORAGE_PREFIX}${documentId}`;

    // Kayıtlı konum ilk ölçümde okunur: sayfa yerleşimi tamamlanmadan
    // scrollHeight güvenilir değil.
    let firstRun = true;

    const onScroll = () => {
      const isFirstRun = firstRun;
      if (firstRun) {
        firstRun = false;
        try {
          const stored = Number(localStorage.getItem(key));
          if (Number.isFinite(stored) && stored > 0 && window.scrollY < 50) setResumeTo(stored);
        } catch {
          /* depolama yok: yalnız ilerleme çubuğu çalışır */
        }
      }
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const current = scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0;
      setRatio(current);

      // Gerçekten okumaya başlandıysa durumu bir kez bildir.
      if (!startedRef.current && current >= MIN_RESUME_RATIO) {
        startedRef.current = true;
        onStartedRef.current?.();
      }

      if (isFirstRun) return;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          // Düşük oranda kayıt SİLİNMEZ: sayfa tepesindeyken gelen bir scroll
          // olayı, kullanıcı "kaldığın yere dön" diyemeden konumu uçururdu.
          // Yalnız sona gelince temizlenir; biten yazı baştan açılır.
          if (current > FINISHED_RATIO) localStorage.removeItem(key);
          else if (current >= MIN_RESUME_RATIO) localStorage.setItem(key, String(window.scrollY));
        } catch {
          /* yoksay */
        }
      }, 400);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [documentId]);

  return (
    <>
      <div
        className="no-print fixed inset-x-0 top-0 z-30 h-0.5 bg-transparent"
        role="progressbar"
        aria-label="Okuma ilerlemesi"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-stone-900 transition-[width] duration-150 dark:bg-stone-100"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      {resumeTo !== null ? (
        <div className="no-print flex items-center gap-2 rounded-lg border border-stone-200 bg-white/70 px-3 py-2 text-xs dark:border-stone-800 dark:bg-stone-900/40">
          <span className="text-stone-600 dark:text-stone-400">Bu yazıyı yarım bırakmıştın.</span>
          <button
            type="button"
            onClick={() => {
              window.scrollTo({ top: resumeTo, behavior: "smooth" });
              setResumeTo(null);
            }}
            className="min-h-[32px] rounded-md bg-stone-900 px-2.5 font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Kaldığın yere dön
          </button>
          <button
            type="button"
            onClick={() => setResumeTo(null)}
            className="ml-auto min-h-[32px] rounded px-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
          >
            Baştan oku
          </button>
        </div>
      ) : null}
    </>
  );
}
