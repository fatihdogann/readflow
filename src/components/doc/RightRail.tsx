"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "@/components/Icons";

export type RailTab = "note" | "highlights" | "chat";

export const RAIL_TABS: Array<{ key: RailTab; label: string }> = [
  { key: "note", label: "Not" },
  { key: "highlights", label: "Vurgular" },
  { key: "chat", label: "AI'a sor" },
];

/**
 * Belgenin tek yardımcı sütunu: Not / Vurgular / AI'a sor sekmeleri.
 *
 * Kabuk (masaüstünde yapışkan sütun, dar ekranda alt sayfa), odak tuzağı,
 * Escape ve gövde kaydırma kilidi burada tek yerde durur — panellerin kendisi
 * yalnızca içeriğini render eder.
 */
export function RightRail({
  tab,
  onTabChange,
  onClose,
  badges,
  children,
}: {
  tab: RailTab;
  onTabChange: (tab: RailTab) => void;
  onClose: () => void;
  badges?: Partial<Record<RailTab, string>>;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  /**
   * Odağı geri verme ve kaydırma kilidi YALNIZCA açılış/kapanışta çalışır:
   * `onClose` her render'da yeni referans olabildiği için tuş efektinden ayrıldı —
   * aksi halde hedef, panel içindeki (kapanınca yok olan) öğeyle değişiyordu.
   */
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (media.matches) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      // Panel kapanınca odak kendi açma düğmesine döner. Düğme DOM'da aranır:
      // panel yeniden oluşturulduğunda (router.refresh) açılışta yakalanan öğe
      // bayatlamış olabilir.
      const trigger = document.querySelector<HTMLElement>(`[data-rail-trigger="${tab}"]`);
      (trigger ?? opener)?.focus();
    };
  }, [tab]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      // Odak tuzağı yalnızca alt sayfa modunda: masaüstünde raf sayfanın parçası.
      if (event.key !== "Tab" || !media.matches || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="no-print fixed inset-0 z-40 lg:sticky lg:top-6 lg:z-auto lg:h-fit lg:max-h-[calc(100vh-3rem)] lg:w-72 lg:shrink-0 xl:w-80">
      <button
        type="button"
        aria-label="Paneli kapat"
        className="absolute inset-0 bg-stone-950/35 backdrop-blur-[2px] lg:hidden"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        aria-label="Belge yardımcı paneli"
        className="absolute inset-x-0 bottom-0 flex h-[78vh] flex-col gap-2 rounded-t-2xl border border-stone-200 bg-[#faf9f7] p-3 shadow-[0_-16px_50px_rgba(28,25,23,0.16)] dark:border-stone-800 dark:bg-[#171512] lg:relative lg:inset-auto lg:h-auto lg:max-h-[calc(100vh-3rem)] lg:rounded-2xl lg:bg-stone-100/70 lg:p-3 lg:shadow-[0_14px_40px_rgba(28,25,23,0.08)] lg:dark:bg-stone-900/55"
      >
        <div className="flex items-center gap-1">
          <div role="tablist" aria-label="Yardımcı panel sekmeleri" className="flex min-w-0 flex-1 gap-0.5">
            {RAIL_TABS.map((entry, index) => (
              <button
                key={entry.key}
                id={`rail-tab-${entry.key}`}
                role="tab"
                aria-selected={tab === entry.key}
                aria-controls={`rail-panel-${entry.key}`}
                tabIndex={tab === entry.key ? 0 : -1}
                onClick={() => onTabChange(entry.key)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : -1;
                  const next = RAIL_TABS[(index + delta + RAIL_TABS.length) % RAIL_TABS.length];
                  onTabChange(next.key);
                  document.getElementById(`rail-tab-${next.key}`)?.focus();
                }}
                className={`flex min-h-[38px] flex-1 items-center justify-center gap-1 rounded-lg px-2 text-xs transition ${
                  tab === entry.key
                    ? "bg-white font-medium text-stone-900 shadow-[0_2px_8px_rgba(28,25,23,0.06)] dark:bg-stone-800 dark:text-stone-100 dark:shadow-none"
                    : "text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
                }`}
              >
                {entry.label}
                {badges?.[entry.key] ? (
                  <span className="rounded-full bg-stone-200 px-1.5 text-[10px] tabular-nums text-stone-700 dark:bg-stone-700 dark:text-stone-200">
                    {badges[entry.key]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Paneli kapat"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div
          id={`rail-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`rail-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {children}
        </div>
      </aside>
    </div>
  );
}
