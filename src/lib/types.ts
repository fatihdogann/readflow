import { z } from "zod";

export const OPERATIONS = ["readability", "summary"] as const;
export type Operation = (typeof OPERATIONS)[number];

/** Kuyrukta geçebilecek tüm iş türleri (chat, remote worker ile belgeye bağlı soru-cevaptır). */
export type JobOperation = Operation | "chat";

export const SUMMARY_LEVELS = ["short", "normal", "detailed"] as const;
export type SummaryLevel = (typeof SUMMARY_LEVELS)[number];

/** DB'de boş değer '' olarak saklanır (UNIQUE constraint'in NULL ile çalışmaması için). */
export type StoredSummaryLevel = SummaryLevel | "";

export const JOB_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const operationSchema = z.enum(OPERATIONS);
export const summaryLevelSchema = z.enum(SUMMARY_LEVELS);
export const operationLabel: Record<Operation, string> = {
  readability: "Okunabilirlik",
  summary: "Özet",
};
export const summaryLevelLabel: Record<SummaryLevel, string> = {
  short: "Kısa",
  normal: "Normal",
  detailed: "Detaylı",
};
export const jobStatusLabel: Record<JobStatus, string> = {
  pending: "Kuyrukta",
  processing: "İşleniyor",
  completed: "Tamamlandı",
  failed: "Hata",
};

export function storedLevel(level: SummaryLevel | null | undefined): StoredSummaryLevel {
  return level ?? "";
}

export function isSummaryLevel(v: string): v is SummaryLevel {
  return (SUMMARY_LEVELS as readonly string[]).includes(v);
}

/** Kullanıcı hatası: API'de 400 olarak döner. */
export class InputError extends Error {}

/** URL mi, düz metin mi? */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (/\s/.test(s)) return false;
  return /^https?:\/\/[^\s]+\.[^\s]{2,}/i.test(s);
}
