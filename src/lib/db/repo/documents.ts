import type { SqliteDb } from "../connection";
import { isFtsEnabled } from "../migrations";
import { nowIso } from "./now";

export interface DocumentRow {
  id: number;
  title: string;
  source_type: "url" | "text";
  source_url: string | null;
  source_domain: string | null;
  author: string | null;
  published_at: string | null;
  original_text: string;
  original_html: string | null;
  favorite: 0 | 1;
  folder_id: number | null;
  note: string;
  note_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertDocumentInput {
  title: string;
  sourceType: "url" | "text";
  sourceUrl?: string | null;
  sourceDomain?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  originalText: string;
  originalHtml?: string | null;
  folderId?: number | null;
}

export interface DocumentFilters {
  q?: string;
  domain?: string;
  /** sayı: belirli klasör; "none": klasörsüz; undefined: filtre yok */
  folderId?: number | "none";
  tag?: string;
  favorite?: boolean;
  limit?: number;
  offset?: number;
}

export function insertDocument(db: SqliteDb, input: InsertDocumentInput): DocumentRow {
  const ts = nowIso();
  const result = db
    .prepare(
      `INSERT INTO documents
        (title, source_type, source_url, source_domain, author, published_at,
         original_text, original_html, favorite, folder_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.sourceType,
      input.sourceUrl ?? null,
      input.sourceDomain ?? null,
      input.author ?? null,
      input.publishedAt ?? null,
      input.originalText,
      input.originalHtml ?? null,
      input.folderId ?? null,
      ts,
      ts,
    );
  return getDocument(db, Number(result.lastInsertRowid))!;
}

export function getDocument(db: SqliteDb, id: number): DocumentRow | null {
  const row = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as
    | DocumentRow
    | undefined;
  return row ?? null;
}

/** FTS5 için "foo bar" -> `"foo"* "bar"*` (prefix araması). */
export function buildFtsMatchQuery(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function listDocuments(db: SqliteDb, filters: DocumentFilters = {}): DocumentRow[] {
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  // WHERE parçaları sabit SQL metinleridir; kullanıcı girdisi yalnızca parametre olarak bağlanır.
  const where: string[] = [];
  const joins: string[] = [];
  const params: Array<string | number> = [];

  const ftsQuery = filters.q ? (isFtsEnabled(db) ? buildFtsMatchQuery(filters.q) : null) : null;
  if (filters.q) {
    if (ftsQuery) {
      joins.push(`JOIN documents_fts fts ON fts.rowid = d.id`);
      where.push(`documents_fts MATCH ?`);
      params.push(ftsQuery);
    } else {
      where.push(`(d.title LIKE ? ESCAPE '\\' OR d.original_text LIKE ? ESCAPE '\\')`);
      const like = `%${escapeLike(filters.q)}%`;
      params.push(like, like);
    }
  }
  if (filters.favorite) {
    where.push(`d.favorite = 1`);
  }
  if (filters.domain) {
    where.push(`d.source_domain = ?`);
    params.push(filters.domain);
  }
  if (filters.folderId === "none") {
    where.push(`d.folder_id IS NULL`);
  } else if (typeof filters.folderId === "number") {
    where.push(`d.folder_id = ?`);
    params.push(filters.folderId);
  }
  if (filters.tag) {
    joins.push(
      `JOIN document_tags dt ON dt.document_id = d.id JOIN tags t ON t.id = dt.tag_id`,
    );
    where.push(`t.name = ?`);
    params.push(filters.tag);
  }

  const orderBy = ftsQuery ? `rank` : `d.created_at DESC, d.id DESC`;
  const sql = [
    `SELECT d.* FROM documents d`,
    ...joins,
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : ``,
    `ORDER BY ${orderBy}`,
    `LIMIT ? OFFSET ?`,
  ]
    .filter(Boolean)
    .join(" ");

  return db.prepare(sql).all(...params, limit, offset) as DocumentRow[];
}

export function listDomains(db: SqliteDb): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT source_domain AS domain FROM documents
       WHERE source_domain IS NOT NULL ORDER BY domain`,
    )
    .all() as Array<{ domain: string }>;
  return rows.map((r) => r.domain);
}

export function setFavorite(db: SqliteDb, id: number, favorite: boolean): void {
  db.prepare(`UPDATE documents SET favorite = ?, updated_at = ? WHERE id = ?`).run(
    favorite ? 1 : 0,
    nowIso(),
    id,
  );
}

export function setFolder(db: SqliteDb, id: number, folderId: number | null): void {
  db.prepare(`UPDATE documents SET folder_id = ?, updated_at = ? WHERE id = ?`).run(
    folderId,
    nowIso(),
    id,
  );
}

export function setTitle(db: SqliteDb, id: number, title: string): void {
  db.prepare(`UPDATE documents SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    nowIso(),
    id,
  );
}

export function updateNote(db: SqliteDb, id: number, note: string): void {
  const trimmed = note.trim();
  db.prepare(
    `UPDATE documents SET note = ?, note_updated_at = ?, updated_at = ? WHERE id = ?`,
  ).run(trimmed, trimmed ? nowIso() : null, nowIso(), id);
}

export function deleteDocument(db: SqliteDb, id: number): void {
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

export function countDocuments(db: SqliteDb): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM documents`).get() as { c: number };
  return row.c;
}
