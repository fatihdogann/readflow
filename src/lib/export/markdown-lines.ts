export interface ContentLine {
  kind: "heading" | "paragraph" | "bullet" | "quote" | "code";
  level: number;
  text: string;
}

/** "#", "##" … başlık seviyesi (yoksa 0). */
function headingLevelOf(raw: string): number {
  let level = 0;
  while (level < 6 && raw.startsWith("#", level)) {
    level += 1;
  }
  if (level === 0) return 0;
  if (level === raw.length) return level;
  return raw[level] === " " ? level : 0;
}

/**
 * Basit markdown satır ayrıştırıcı — DOCX ve PDF üreticileri ortak kullanır.
 * Markdown tabloları satır bazında metin olarak korunur (hücre hizalaması değil).
 */
export function parseMarkdownLines(markdown: string): ContentLine[] {
  const lines: ContentLine[] = [];
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (raw.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push({ kind: "code", level: 0, text: raw });
      continue;
    }
    const headingLevel = headingLevelOf(raw);
    if (headingLevel > 0) {
      lines.push({ kind: "heading", level: headingLevel, text: raw.slice(headingLevel).trim() });
      continue;
    }
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) {
      lines.push({ kind: "bullet", level: 0, text: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed.startsWith("> ")) {
      lines.push({ kind: "quote", level: 0, text: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed === ">") {
      lines.push({ kind: "quote", level: 0, text: "" });
      continue;
    }
    lines.push({ kind: "paragraph", level: 0, text: raw });
  }
  return lines;
}
