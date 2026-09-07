"use client";

import { useEffect } from "react";
import { CloseIcon } from "@/components/Icons";

const AUTO_DISMISS_MS = 6000;

/**
 * Kısa bildirim. Önceden satır içi metin olarak gösteriliyordu ve sayfa
 * kaydırılınca görünmez oluyordu; ekrana sabitlenir ve kendiliğinden kapanır.
 */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-start gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-3 text-xs leading-relaxed shadow-[0_14px_40px_rgba(28,25,23,0.18)] dark:border-stone-700 dark:bg-stone-900 sm:left-auto sm:right-6 sm:mx-0"
    >
      <span className="min-w-0 flex-1 text-stone-700 dark:text-stone-200">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Bildirimi kapat"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}
