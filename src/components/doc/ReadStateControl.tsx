"use client";

import type { ReadState } from "@/lib/db/repo/documents";

const OPTIONS: Array<{ value: ReadState; label: string; title: string }> = [
  { value: "unread", label: "Okunacak", title: "Henüz okumadım" },
  { value: "reading", label: "Okuyorum", title: "Devam ediyorum" },
  { value: "done", label: "Bitti", title: "Okumayı bitirdim" },
];

/** Üç durumlu okuma akışı seçici (belge başlığında ve liste kartında aynı dil). */
export function ReadStateControl({
  value,
  onChange,
  size = "md",
}: {
  value: ReadState;
  onChange: (next: ReadState) => void;
  size?: "sm" | "md";
}) {
  const height = size === "sm" ? "min-h-[28px] px-2 text-[11px]" : "min-h-[34px] px-2.5 text-xs";
  return (
    <div
      role="radiogroup"
      aria-label="Okuma durumu"
      className="flex overflow-hidden rounded-lg border border-stone-300 dark:border-stone-700"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`${height} ${
            value === option.value
              ? "bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-stone-100"
              : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
