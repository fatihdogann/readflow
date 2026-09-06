import type { ExportPayload } from "./types";
import { payloadContent } from "./content";
import { isSummaryLevel, operationLabel, summaryLevelLabel } from "../types";

function outputTitle(output: ExportPayload["output"]): string {
  if (!output) return "Orijinal";
  if (output.operation === "summary" && isSummaryLevel(output.summary_level)) {
    return `${operationLabel.summary} (${summaryLevelLabel[output.summary_level]})`;
  }
  return operationLabel[output.operation];
}

function metaLines(payload: ExportPayload, variantLabel?: string): string[] {
  const { document } = payload;
  const lines: string[] = [];
  if (document.source_url) lines.push(`Kaynak: ${document.source_url}`);
  else lines.push("Kaynak: Yapıştırılan metin");
  if (document.source_domain) lines.push(`Domain: ${document.source_domain}`);
  if (document.author) lines.push(`Yazar: ${document.author}`);
  if (document.published_at) lines.push(`Yayın: ${document.published_at}`);
  lines.push(`Bölüm: ${variantLabel ?? outputTitle(payload.output)}`);
  lines.push(`Arşiv tarihi: ${document.created_at}`);
  return lines;
}

export function buildMarkdown(payload: ExportPayload, variantLabel?: string): string {
  const { document } = payload;
  const content = payloadContent(payload);
  const header = [
    `# ${document.title}`,
    "",
    ...metaLines(payload, variantLabel).map((line) => `- ${line}`),
    "",
    "---",
    "",
  ];
  const parts = [...header, content.trim()];
  if (document.note.trim()) {
    parts.push("", "---", "", "## Kişisel Not", "", document.note.trim());
  }
  parts.push("");
  return parts.join("\n");
}

export function buildTxt(payload: ExportPayload, variantLabel?: string): string {
  const { document } = payload;
  const content = payloadContent(payload);
  const header = [
    document.title.toUpperCase(),
    "",
    ...metaLines(payload, variantLabel),
    "",
    "----------------------------------------",
    "",
  ];
  const parts = [...header, content.trim()];
  if (document.note.trim()) {
    parts.push("", "----------------------------------------", "KIŞISEL NOT", "", document.note.trim());
  }
  parts.push("");
  return parts.join("\n");
}

export function outputLabel(payload: ExportPayload): string {
  return outputTitle(payload.output);
}

/** Dosya adı için güvenli slug. */
export function slugify(title: string): string {
  const slug = title
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "readflow";
}
