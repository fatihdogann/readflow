import { InputError } from "../types";
import { sanitizeArticleHtml } from "./sanitize";
import type { ArticleExtraction } from "./fetchArticle";
import { OCR_INSTALL_HINT, ocrAvailable, ocrPdf } from "./ocr";

/** PDF sayfa sayısı yüksek olabilir; metin sınırı HTML yolundakiyle aynı. */
const MAX_TEXT_CHARS = 2_000_000;
const MAX_HTML_CHARS = 3_000_000;

export type BinaryKind = "pdf" | "docx" | "text" | "html";

/**
 * Dosya türünü içeriğin kendi imzasından (magic bytes) belirler; uzantı ve
 * content-type yanıltıcı olabilir. Tanınmayan ikili içerik null döner.
 */
export function detectKind(buffer: Buffer, contentType = "", fileName = ""): BinaryKind | null {
  if (buffer.length >= 4) {
    // %PDF
    if (buffer.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
    // ZIP kabuğu: docx bir OOXML zip'idir
    const zip = buffer.subarray(0, 4);
    if (zip[0] === 0x50 && zip[1] === 0x4b && (zip[2] === 0x03 || zip[2] === 0x05 || zip[2] === 0x07)) {
      // Sadece .docx kabul edilir; xlsx/pptx metin çıkarımı bu yolda yok.
      const looksDocx =
        /officedocument\.wordprocessingml|word\//i.test(buffer.subarray(0, 4096).toString("latin1")) ||
        /\.docx$/i.test(fileName) ||
        contentType.includes("wordprocessingml");
      return looksDocx ? "docx" : null;
    }
  }
  const type = contentType.toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("wordprocessingml") || /\.docx$/i.test(fileName)) return "docx";
  if (/text\/html|application\/xhtml\+xml/.test(type)) return "html";
  if (type.startsWith("text/") || /\.(txt|md|markdown|csv)$/i.test(fileName)) return "text";
  return null;
}

/** PDF metnini çıkarır; sayfalar boş satırla ayrılır. */
async function extractPdf(buffer: Buffer, label: string): Promise<ArticleExtraction> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let text: string;
  let title = "";
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: false });
    text = (Array.isArray(result.text) ? result.text : [String(result.text)])
      .map((page) => page.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = metadata?.info as { Title?: unknown } | undefined;
    if (typeof info?.Title === "string") title = info.Title.trim();
  } catch {
    throw new InputError("PDF okunamadı (bozuk veya şifreli olabilir)");
  }
  let domain = "pdf";
  if (text.replace(/\s/g, "").length < 30) {
    // Taranmış (görsel) PDF: yerel OCR varsa dene.
    if (!ocrAvailable()) {
      throw new InputError(`PDF'te seçilebilir metin yok — taranmış bir belge gibi görünüyor. ${OCR_INSTALL_HINT}`);
    }
    try {
      text = await ocrPdf(buffer);
    } catch {
      throw new InputError("Taranmış PDF OCR ile okunamadı");
    }
    if (text.replace(/\s/g, "").length < 30) {
      throw new InputError("OCR sonrası da okunabilir metin bulunamadı");
    }
    domain = "pdf-ocr";
  }
  return {
    title: (title || label).slice(0, 300),
    author: null,
    publishedAt: null,
    originalText: text.slice(0, MAX_TEXT_CHARS),
    originalHtml: null,
    domain,
  };
}

/** DOCX'i HTML'e çevirir; sanitize edilmiş HTML ve düz metin birlikte döner. */
async function extractDocx(buffer: Buffer, label: string): Promise<ArticleExtraction> {
  const mammoth = (await import("mammoth")).default;
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer })).value;
  } catch {
    throw new InputError("Word belgesi okunamadı (bozuk olabilir)");
  }
  const sanitized = sanitizeArticleHtml(html);
  const text = sanitized
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 30) throw new InputError("Word belgesinde okunabilir metin bulunamadı");

  // İlk başlık satırı varsa başlık olarak kullan.
  const heading = /<h1[^>]*>(.*?)<\/h1>/i.exec(sanitized)?.[1]?.replace(/<[^>]+>/g, "").trim();
  return {
    title: (heading || label).slice(0, 300),
    author: null,
    publishedAt: null,
    originalText: text.slice(0, MAX_TEXT_CHARS),
    originalHtml: sanitized.slice(0, MAX_HTML_CHARS),
    domain: "docx",
  };
}

/**
 * İkili içerikten (PDF/DOCX/düz metin) doküman çıkarır.
 * HTML için `extractFromHtml` kullanılır — o yol Readability'den geçer.
 */
export async function extractFromBuffer(
  buffer: Buffer,
  options: { contentType?: string; fileName?: string; label?: string } = {},
): Promise<ArticleExtraction> {
  const kind = detectKind(buffer, options.contentType ?? "", options.fileName ?? "");
  const label = options.label ?? options.fileName?.replace(/\.[^.]+$/, "") ?? "Adsız belge";

  if (kind === "pdf") return extractPdf(buffer, label);
  if (kind === "docx") return extractDocx(buffer, label);
  if (kind === "text") {
    const text = buffer.toString("utf8").trim();
    if (text.length < 1) throw new InputError("Dosya boş görünüyor");
    return {
      title: label.slice(0, 300),
      author: null,
      publishedAt: null,
      originalText: text.slice(0, MAX_TEXT_CHARS),
      originalHtml: null,
      domain: "text",
    };
  }
  throw new InputError(
    `Desteklenmeyen dosya türü${options.contentType ? `: ${options.contentType}` : ""}. PDF, Word (.docx), Markdown ve düz metin desteklenir.`,
  );
}
