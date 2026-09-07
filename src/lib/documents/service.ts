import type { SqliteDb } from "../db/connection";
import { getDocument, insertDocument, type DocumentRow } from "../db/repo/documents";
import { getEdit } from "../db/repo/documentEdits";
import { listJobsByDocument, type JobRow } from "../db/repo/jobs";
import { listOutputs, type OutputRow } from "../db/repo/outputs";
import { listDocumentTags } from "../db/repo/tags";
import { assertPublicHttpUrl, extractFromHtml, fetchArticle } from "../extraction/fetchArticle";
import { extractFromBuffer } from "../extraction/fromBuffer";
import { InputError, looksLikeUrl } from "../types";

export interface DocumentEditInfo {
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentDetail {
  document: DocumentRow;
  /** Kullanıcı sürümü (yoksa null). original_text asla değişmez; düzenleme ayrı tutulur. */
  edit: DocumentEditInfo | null;
  outputs: OutputRow[];
  jobs: JobRow[];
  tags: string[];
}

export interface CreateDocumentInput {
  url?: string;
  text?: string;
  /** Tarayıcıdan gelen sayfa kaynağı (bookmarklet / elle yapıştırma). */
  html?: string;
  /** `html` ile birlikte: sayfanın gerçek adresi. */
  sourceUrl?: string;
  /** Yüklenen dosya (PDF/Word/metin). */
  file?: { buffer: Buffer; fileName: string; contentType: string };
  title?: string;
  folderId?: number | null;
}

const TITLE_MAX = 300;

export function titleFromText(text: string, provided?: string): string {
  const explicit = provided?.trim();
  if (explicit) return explicit.slice(0, TITLE_MAX);
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (!firstLine) return "Adsız metin";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

/**
 * URL ise server-side fetch + Readability extraction,
 * düz metin ise doğrudan kayıt. AI kullanılmaz.
 */
export async function createDocumentFromInput(
  db: SqliteDb,
  input: CreateDocumentInput,
): Promise<DocumentRow> {
  const url = input.url?.trim();
  const text = input.text?.trim();
  const html = input.html?.trim();

  // Dosya yükleme: PDF / Word / Markdown / düz metin.
  if (input.file) {
    const article = await extractFromBuffer(input.file.buffer, {
      contentType: input.file.contentType,
      fileName: input.file.fileName,
      label: input.file.fileName.replace(/\.[^.]+$/, ""),
    });
    return insertDocument(db, {
      title: (input.title?.trim() || article.title).slice(0, TITLE_MAX),
      sourceType: "text",
      sourceDomain: article.domain,
      author: article.author,
      publishedAt: article.publishedAt,
      originalText: article.originalText,
      originalHtml: article.originalHtml,
      folderId: input.folderId ?? null,
    });
  }

  /**
   * Tarayıcıdan gelen HTML: sunucu sayfayı indirmez. Bot koruması, paywall ve
   * JS ile üretilen sayfalar bu yoldan geçer — içerik kullanıcının kendi
   * oturumundaki tarayıcıda zaten çözülmüştür.
   */
  if (html) {
    const sourceUrl = input.sourceUrl?.trim();
    if (sourceUrl && !looksLikeUrl(sourceUrl)) {
      throw new InputError("Kaynak adres geçerli bir http(s) adresi değil");
    }
    // Yalnızca adresin doğruluğu doğrulanır; istek atılmaz.
    const base = sourceUrl ? assertPublicHttpUrl(sourceUrl).href : "https://readflow.local/";
    const article = extractFromHtml(html, base);
    return insertDocument(db, {
      title: (input.title?.trim() || article.title).slice(0, TITLE_MAX),
      sourceType: sourceUrl ? "url" : "text",
      sourceUrl: sourceUrl ?? null,
      sourceDomain: sourceUrl ? article.domain : null,
      author: article.author,
      publishedAt: article.publishedAt,
      originalText: article.originalText,
      originalHtml: article.originalHtml,
      folderId: input.folderId ?? null,
    });
  }

  if (url) {
    if (!looksLikeUrl(url)) {
      throw new InputError("Bu geçerli bir http(s) adresine benzemiyor");
    }
    const article = await fetchArticle(url);
    return insertDocument(db, {
      title: (input.title?.trim() || article.title).slice(0, TITLE_MAX),
      sourceType: "url",
      sourceUrl: url,
      sourceDomain: article.domain,
      author: article.author,
      publishedAt: article.publishedAt,
      originalText: article.originalText,
      originalHtml: article.originalHtml,
      folderId: input.folderId ?? null,
    });
  }

  if (text) {
    return insertDocument(db, {
      title: titleFromText(text, input.title).slice(0, TITLE_MAX),
      sourceType: "text",
      originalText: text,
      folderId: input.folderId ?? null,
    });
  }

  throw new InputError("Bir bağlantı, metin, HTML veya dosya sağlamalısın");
}

export function getDocumentDetail(db: SqliteDb, id: number): DocumentDetail | null {
  const document = getDocument(db, id);
  if (!document) return null;
  const edit = getEdit(db, id);
  return {
    document,
    edit: edit
      ? { content: edit.content, revision: edit.revision, created_at: edit.created_at, updated_at: edit.updated_at }
      : null,
    outputs: listOutputs(db, id),
    jobs: listJobsByDocument(db, id, 10),
    tags: listDocumentTags(db, id),
  };
}
