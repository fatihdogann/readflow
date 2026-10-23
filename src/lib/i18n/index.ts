import english from "./en.json";

export type Locale = "tr" | "en";
export function parseLocale(value: unknown): Locale {
  return value === "en" ? "en" : "tr";
}

export function translator(locale: Locale) {
  return (text: string, ...values: (string | number)[]): string => {
    const translated = locale === "en" && Object.hasOwn(english, text) ? (english as Record<string, string>)[text] : text;
    return translated.replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? match));
  };
}
