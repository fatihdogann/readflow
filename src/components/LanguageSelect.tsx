"use client";

import { useLocale } from "@/lib/i18n/client";
import { parseLocale } from "@/lib/i18n";

export function LanguageSelect() {
  const locale = useLocale();
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 px-3 text-xs text-stone-600 dark:text-stone-400">
      {locale === "tr" ? "Dil" : "Language"}
      <select
        aria-label={locale === "tr" ? "Uygulama dili" : "App language"}
        value={locale}
        onChange={(event) => {
          document.cookie = `readflow-language=${parseLocale(event.target.value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
          window.location.reload();
        }}
        className="min-h-11 rounded-md border border-stone-300 bg-transparent px-2 dark:border-stone-700"
      >
        <option value="tr">Türkçe</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
