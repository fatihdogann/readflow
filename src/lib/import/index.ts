import fs from "node:fs";
import path from "node:path";
import type { SqliteDb } from "../db/connection";
import { deleteDocument } from "../db/repo/documents";
import { setDocumentTags } from "../db/repo/tags";
import { createDocumentFromInput, type CreateDocumentInput } from "../documents/service";
import { looksLikeUrl } from "../types";

export interface UrlEntry {
  url: string;
  title?: string;
  tags: string[];
}

/** RFC 4180 CSV: tırnaklı alanlar, kaçışlı tırnak ("") ve alan içi satır sonu. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

/** "a|b", "a, b", `["a","b"]` biçimlerindeki etiketleri böler. */
function splitTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\s*\[|\]\s*$/g, "")
    .split(/[|,;]/)
    .map((tag) => tag.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Okuma uygulaması dışa aktarımlarını bağlantı listesine çevirir:
 * - CSV (Instapaper, Pocket, Readwise Reader…): `url` sütunu olan her dosya
 * - HTML: Netscape yer imi dosyası (tarayıcılar, Pocket, Instapaper HTML dışa aktarımı)
 * Liste değilse null döner; dosya normal belge olarak işlenir.
 */
export function parseUrlList(content: string, fileName: string): UrlEntry[] | null {
  if (/\.csv$/i.test(fileName)) {
    const [header, ...rows] = parseCsv(content.replace(/^﻿/, ""));
    const columns = (header ?? []).map((name) => name.trim().toLowerCase());
    const col = (...names: string[]) => columns.findIndex((name) => names.includes(name));
    const urlCol = col("url", "source url", "link");
    if (urlCol < 0) return null;
    const titleCol = col("title", "name");
    const tagsCol = col("tags", "document tags", "labels");
    return rows
      .map((cells) => ({
        url: cells[urlCol]?.trim() ?? "",
        title: (titleCol >= 0 && cells[titleCol]?.trim()) || undefined,
        tags: tagsCol >= 0 ? splitTags(cells[tagsCol]) : [],
      }))
      .filter((entry) => looksLikeUrl(entry.url));
  }
  if (/\.html?$/i.test(fileName)) {
    const isList =
      /<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(content) || /<title>\s*(Pocket|Instapaper)[^<]*<\/title>/i.test(content);
    if (!isList) return null;
    const entries: UrlEntry[] = [];
    for (const match of content.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = match[1];
      const url = decodeEntities(/href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "");
      if (!looksLikeUrl(url)) continue;
      const title = decodeEntities(match[2].replace(/<[^>]+>/g, "")).trim() || undefined;
      entries.push({ url, title, tags: splitTags(/tags\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]) });
    }
    return entries;
  }
  return null;
}

const DOCUMENT_EXTENSIONS = /\.(md|markdown|txt|html?|pdf|docx)$/i;

function walk(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs
    .readdirSync(target)
    .filter((name) => !name.startsWith("."))
    .sort()
    .flatMap((name) => walk(path.join(target, name)));
}

export interface ImportOptions {
  /** Bağlantı → belge girdisi. Varsayılan: sunucu sayfayı indirir (SSRF korumalı). */
  fetchUrl?: (url: string) => Promise<Partial<CreateDocumentInput>>;
  /** Siteleri yormamak için bağlantılar arası bekleme. */
  delayMs?: number;
  onProgress?: (line: string) => void;
}

export interface ImportResult {
  created: number;
  skipped: number;
  failed: Array<{ item: string; error: string }>;
}

/** Aynı başlık ve metne sahip daha eski bir belge varsa yeni kaydı geri alır. */
function dropIfDuplicate(db: SqliteDb, id: number): boolean {
  const duplicate = db
    .prepare(
      `SELECT 1 FROM documents a JOIN documents b ON a.title = b.title AND a.original_text = b.original_text
       WHERE a.id = ? AND b.id <> a.id LIMIT 1`,
    )
    .get(id);
  if (duplicate) deleteDocument(db, id);
  return Boolean(duplicate);
}

/**
 * Dosya ve klasörleri içe aktarır. Bağlantı listeleri tek tek eklenir; arşivde
 * aynı adres (silinmişler dahil) varsa atlanır. Hatalar işi durdurmaz, raporlanır.
 */
export async function importPaths(db: SqliteDb, targets: string[], options: ImportOptions = {}): Promise<ImportResult> {
  const { fetchUrl = async (url: string) => ({ url }), delayMs = 1000, onProgress = () => {} } = options;
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };
  const knownUrl = db.prepare(`SELECT 1 FROM documents WHERE source_url = ? LIMIT 1`);

  for (const file of targets.flatMap((target) => walk(path.resolve(target)))) {
    const name = path.basename(file);
    const buffer = fs.readFileSync(file);
    const list = /\.(csv|html?)$/i.test(name) ? parseUrlList(buffer.toString("utf8"), name) : null;

    if (list) {
      onProgress(`${name}: ${list.length} bağlantı`);
      for (const entry of list) {
        if (knownUrl.get(entry.url)) {
          result.skipped++;
          continue;
        }
        try {
          const input = await fetchUrl(entry.url);
          const doc = await createDocumentFromInput(db, { ...input, sourceUrl: entry.url, title: entry.title });
          if (entry.tags.length) setDocumentTags(db, doc.id, entry.tags);
          result.created++;
          onProgress(`  + ${entry.url}`);
        } catch (error) {
          result.failed.push({ item: entry.url, error: error instanceof Error ? error.message : String(error) });
          onProgress(`  ✗ ${entry.url}`);
        }
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      continue;
    }

    if (!DOCUMENT_EXTENSIONS.test(name)) {
      result.skipped++;
      continue;
    }
    try {
      const label = name.replace(/\.[^.]+$/, "");
      const input: CreateDocumentInput = /\.html?$/i.test(name)
        ? { html: buffer.toString("utf8") }
        : { file: { buffer, fileName: name, contentType: "" }, title: label };
      const doc = await createDocumentFromInput(db, input);
      if (dropIfDuplicate(db, doc.id)) {
        result.skipped++;
      } else {
        result.created++;
        onProgress(`+ ${file}`);
      }
    } catch (error) {
      result.failed.push({ item: file, error: error instanceof Error ? error.message : String(error) });
      onProgress(`✗ ${file}`);
    }
  }
  return result;
}
