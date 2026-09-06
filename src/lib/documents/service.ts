import type { SqliteDb } from "../db/connection";
import { getDocument, insertDocument, type DocumentRow } from "../db/repo/documents";
import { listJobsByDocument, type JobRow } from "../db/repo/jobs";
import { listOutputs, type OutputRow } from "../db/repo/outputs";
import { listDocumentTags } from "../db/repo/tags";
import { fetchArticle } from "../extraction/fetchArticle";
import { InputError, looksLikeUrl } from "../types";

export interface DocumentDetail {
  document: DocumentRow;
  outputs: OutputRow[];
  jobs: JobRow[];
  tags: string[];
}

export interface CreateDocumentInput {
  url?: string;
  text?: string;
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

  throw new InputError("Bir bağlantı veya metin sağlamalısın");
}

export function getDocumentDetail(db: SqliteDb, id: number): DocumentDetail | null {
  const document = getDocument(db, id);
  if (!document) return null;
  return {
    document,
    outputs: listOutputs(db, id),
    jobs: listJobsByDocument(db, id, 10),
    tags: listDocumentTags(db, id),
  };
}
