import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { payloadContent } from "./content";
import { parseMarkdownLines } from "./markdown-lines";
import type { ExportPayload } from "./types";

const FONT_REGULAR = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");

// A4: 595.28 x 841.89 pt
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.11, 0.1, 0.09);
const MUTED = rgb(0.42, 0.4, 0.38);
const RULE = rgb(0.8, 0.78, 0.76);

interface Layout {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
}

function newPage(layout: Layout): void {
  layout.page = layout.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  layout.y = PAGE_HEIGHT - MARGIN;
}

function ensureSpace(layout: Layout, needed: number): void {
  if (layout.y - needed < MARGIN) newPage(layout);
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // Tek kelime satıra sığmıyorsa karakter bazında böl.
    if (font.widthOfTextAtSize(word, size) > width) {
      let chunk = "";
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > width) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawLines(
  layout: Layout,
  lines: string[],
  font: PDFFont,
  size: number,
  lineHeight: number,
  color = INK,
  indent = 0,
): void {
  for (const line of lines) {
    ensureSpace(layout, lineHeight);
    layout.page.drawText(line, {
      x: MARGIN + indent,
      y: layout.y - size,
      size,
      font,
      color,
    });
    layout.y -= lineHeight;
  }
}

/**
 * Sunucu tarafında gerçek .pdf üretir: Türkçe karakterler gömülü DejaVu ile,
 * okuma sütunu genişliğinde, sidebar/düğme gibi arayüz öğeleri hiç dahil edilmeden.
 */
export async function buildPdf(payload: ExportPayload, variantLabel: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fs.readFileSync(FONT_REGULAR));
  const bold = await doc.embedFont(fs.readFileSync(FONT_BOLD));
  doc.setTitle(payload.document.title);
  doc.setProducer("Readflow");

  const layout: Layout = { doc, page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN, regular, bold };

  // Başlık + üst bilgi + kaynak
  const titleLines = wrapText(payload.document.title, bold, 19, CONTENT_WIDTH);
  drawLines(layout, titleLines, bold, 19, 25);

  const metaParts = [
    `Sürüm: ${variantLabel}`,
    payload.document.source_url ? `Kaynak: ${payload.document.source_url}` : "Kaynak: Yapıştırılan metin",
    payload.document.author ? `Yazar: ${payload.document.author}` : null,
    `Arşiv: ${payload.document.created_at.slice(0, 10)}`,
    payload.document.note.trim() ? "Notlar: dahil" : null,
  ].filter((value): value is string => Boolean(value));
  for (const meta of metaParts) {
    drawLines(layout, wrapText(meta, regular, 8.5, CONTENT_WIDTH), regular, 8.5, 12, MUTED);
  }
  ensureSpace(layout, 18);
  layout.page.drawLine({
    start: { x: MARGIN, y: layout.y - 8 },
    end: { x: PAGE_WIDTH - MARGIN, y: layout.y - 8 },
    thickness: 0.75,
    color: RULE,
  });
  layout.y -= 24;

  const content = payloadContent(payload);
  for (const line of parseMarkdownLines(content)) {
    if (line.kind === "heading") {
      const size = line.level <= 1 ? 15 : line.level === 2 ? 13 : 11.5;
      layout.y -= 8;
      drawLines(layout, wrapText(line.text, bold, size, CONTENT_WIDTH), bold, size, size + 5);
      layout.y -= 4;
    } else if (line.kind === "bullet") {
      ensureSpace(layout, 15);
      layout.page.drawText("•", { x: MARGIN + 4, y: layout.y - 10, size: 10, font: regular, color: INK });
      drawLines(layout, wrapText(line.text, regular, 10, CONTENT_WIDTH - 18), regular, 10, 15, INK, 18);
    } else if (line.kind === "quote") {
      ensureSpace(layout, 15);
      layout.page.drawLine({
        start: { x: MARGIN + 2, y: layout.y - 10 },
        end: { x: MARGIN + 2, y: layout.y - 10 },
        thickness: 0,
        color: RULE,
      });
      drawLines(layout, wrapText(line.text, regular, 10, CONTENT_WIDTH - 16), regular, 10, 14.5, MUTED, 14);
    } else if (line.kind === "code") {
      drawLines(layout, wrapText(line.text, regular, 8.5, CONTENT_WIDTH - 16), regular, 8.5, 12, MUTED, 14);
    } else {
      if (!line.text.trim()) {
        layout.y -= 7;
        continue;
      }
      drawLines(layout, wrapText(line.text, regular, 10.5, CONTENT_WIDTH), regular, 10.5, 16);
      layout.y -= 4;
    }
  }

  // Son sayfa alt bilgisi: belge bağlantısı
  if (payload.document.source_url) {
    ensureSpace(layout, 30);
    layout.page.drawLine({
      start: { x: MARGIN, y: layout.y - 6 },
      end: { x: PAGE_WIDTH - MARGIN, y: layout.y - 6 },
      thickness: 0.75,
      color: RULE,
    });
    drawLines(
      layout,
      wrapText(`Kaynak bağlantısı: ${payload.document.source_url}`, regular, 8.5, CONTENT_WIDTH),
      regular,
      8.5,
      12,
      MUTED,
    );
  }

  return doc.save();
}
