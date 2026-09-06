import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { ExportPayload } from "./types";

interface Line {
  kind: "heading" | "paragraph" | "bullet" | "quote" | "code";
  text: string;
}

/** "#", "##" … başlık seviyesini döndürür; başlık değilse 0. */
function headingLevelOf(raw: string): number {
  let level = 0;
  while (level < 6 && raw.startsWith("#", level)) {
    level += 1;
  }
  if (level === 0) return 0;
  if (level === raw.length) return level; // yalnızca #'ler
  return raw[level] === " " ? level : 0;
}

/** Basit markdown satır ayrıştırıcı (başlık, madde, alıntı, kod, paragraf). */
function parseLines(markdown: string): Line[] {
  const lines: Line[] = [];
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (raw.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push({ kind: "code", text: raw });
      continue;
    }
    const headingLevel = headingLevelOf(raw);
    if (headingLevel > 0) {
      lines.push({ kind: "heading", text: raw.slice(headingLevel).trim() });
      continue;
    }
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) {
      lines.push({ kind: "bullet", text: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed.startsWith("> ")) {
      lines.push({ kind: "quote", text: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed === ">") {
      lines.push({ kind: "quote", text: "" });
      continue;
    }
    lines.push({ kind: "paragraph", text: raw });
  }
  return lines;
}

const HEADING_MAP = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

/** DOCX'i tamamen lokalde üretir (harici servis yok). */
export async function buildDocxBuffer(payload: ExportPayload): Promise<Buffer> {
  const { document, output } = payload;
  const content = output ? output.content : document.original_text;

  const metaTexts = [
    document.source_url ? `Kaynak: ${document.source_url}` : "Kaynak: Yapıştırılan metin",
    document.author ? `Yazar: ${document.author}` : null,
    document.published_at ? `Yayın: ${document.published_at}` : null,
    `Arşiv: ${document.created_at}`,
  ].filter((value): value is string => Boolean(value));

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: document.title, bold: true })],
    }),
    ...metaTexts.map(
      (line) =>
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: line, size: 18, color: "666666" })],
        }),
    ),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
      spacing: { after: 240 },
      children: [],
    }),
  ];

  for (const line of parseLines(content)) {
    if (line.kind === "heading") {
      children.push(
        new Paragraph({
          heading: HEADING_MAP[2],
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: line.text, bold: true })],
        }),
      );
    } else if (line.kind === "bullet") {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: line.text })],
        }),
      );
    } else if (line.kind === "quote") {
      children.push(
        new Paragraph({
          indent: { left: 480 },
          spacing: { after: 60 },
          children: [new TextRun({ text: line.text, italics: true, color: "444444" })],
        }),
      );
    } else if (line.kind === "code") {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: line.text, font: "Menlo", size: 18 })],
        }),
      );
    } else if (line.text.trim()) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { after: 120, line: 320 },
          children: [new TextRun({ text: line.text })],
        }),
      );
    }
  }

  const doc = new Document({
    creator: "Readflow",
    title: document.title,
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
