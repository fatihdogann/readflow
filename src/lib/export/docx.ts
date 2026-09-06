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
import { payloadContent } from "./content";
import { parseMarkdownLines } from "./markdown-lines";

const HEADING_MAP = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

/** DOCX'i tamamen lokalde üretir (harici servis yok). */
export async function buildDocxBuffer(payload: ExportPayload): Promise<Buffer> {
  const { document } = payload;
  const content = payloadContent(payload);

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

  for (const line of parseMarkdownLines(content)) {
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

  if (document.note.trim()) {
    children.push(
      new Paragraph({
        heading: HEADING_MAP[2],
        spacing: { before: 360, after: 120 },
        children: [new TextRun({ text: "Kişisel Not", bold: true })],
      }),
    );
    for (const paragraph of document.note.trim().split(/\n{2,}/)) {
      children.push(
        new Paragraph({
          spacing: { after: 120, line: 320 },
          children: [new TextRun({ text: paragraph.replace(/\n/g, " ") })],
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
