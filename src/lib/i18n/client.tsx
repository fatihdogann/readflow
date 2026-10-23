"use client";

import { createContext, useContext, useMemo } from "react";
import { translator, type Locale } from "./index";

const LanguageContext = createContext<Locale>("tr");
export function LanguageProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LanguageContext.Provider value={locale}>{children}</LanguageContext.Provider>;
}
export function useLocale() {
  return useContext(LanguageContext);
}
export function useT() {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
