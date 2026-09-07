import type { SqliteDb } from "../connection";
import { buildFtsMatchQuery, isFtsEnabled } from "../migrations";
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
  read_state: ReadState;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export const READ_STATES = ["unread", "reading", "done"] as const;
export type ReadState = (typeof READ_STATES)[number];

export function isReadState(value: unknown): value is ReadState {
  return typeof value === "string" && (READ_STATES as readonly string[]).includes(value);
}

/** Liste/arama sonuçları için hafif projeksiyon: tam metin/HTML taşımaz. */
export interface DocumentListItem {
  id: number;
  title: string;
  source_type: "url" | "text";
  source_domain: string | null;
  author: string | null;
  published_at: string | null;
  favorite: 0 | 1;
  folder_id: number | null;
  created_at: string;
  updated_at: string;
  preview: string;
  has_note: 0 | 1;
  has_edit: 0 | 1;
  read_state: ReadState;
  /** Aramada hangi alan eşleşti (LIKE fallback'te doldurulur, FTS'te de etiketlenir). */
  matched?: string[];
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
  readState?: ReadState;
  notlu?: boolean;
  duzenlenmis?: boolean;
  agent?: string;
  limit?: number;
  offset?: number;
}

const LIST_COLUMNS = `
  d.id, d.title, d.source_type, d.source_domain, d.author, d.published_at,
  d.favorite, d.folder_id, d.created_at, d.updated_at, d.read_state,
  substr(d.original_text, 1, 180) AS preview,
  CASE WHEN d.note != '' THEN 1 ELSE 0 END AS has_note,
  CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS has_edit
`;

const FROM_JOINS = `
  FROM documents d
  LEFT JOIN document_edits e ON e.document_id = d.id
`;

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

/** Silinmiş (çöpteki) doküman döndürmez — geri alınana kadar yok sayılır. */
export function getDocument(db: SqliteDb, id: number): DocumentRow | null {
  const row = db
    .prepare(`SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as DocumentRow | undefined;
  return row ?? null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildWhere(filters: DocumentFilters, ftsQuery: string | null): {
  where: string[];
  joins: string[];
  params: Array<string | number>;
} {
  // Soft delete: çöpteki dokümanlar hiçbir listede görünmez.
  const where: string[] = ["d.deleted_at IS NULL"];
  const joins: string[] = [];
  const params: Array<string | number> = [];

  if (filters.q) {
    if (ftsQuery) {
      joins.push(`JOIN documents_fts fts ON fts.rowid = d.id`);
      where.push(`documents_fts MATCH ?`);
      params.push(ftsQuery);
    } else {
      where.push(`(d.title LIKE ? ESCAPE '\\' OR d.original_text LIKE ? ESCAPE '\\' OR d.note LIKE ? ESCAPE '\\')`);
      const like = `%${escapeLike(filters.q)}%`;
      params.push(like, like, like);
    }
  }
  if (filters.favorite) where.push(`d.favorite = 1`);
  if (filters.readState) {
    where.push(`d.read_state = ?`);
    params.push(filters.readState);
  }
  if (filters.domain) {
    where.push(`d.source_domain = ?`);
    params.push(filters.domain);
  }
  if (filters.folderId === "none") where.push(`d.folder_id IS NULL`);
  else if (typeof filters.folderId === "number") {
    where.push(`d.folder_id = ?`);
    params.push(filters.folderId);
  }
  if (filters.tag) {
    joins.push(`JOIN document_tags dt ON dt.document_id = d.id JOIN tags t ON t.id = dt.tag_id`);
    where.push(`t.name = ?`);
    params.push(filters.tag);
  }
  if (filters.notlu) where.push(`d.note != ''`);
  if (filters.duzenlenmis) where.push(`e.id IS NOT NULL`);
  if (filters.agent) {
    where.push(`EXISTS (SELECT 1 FROM document_outputs o WHERE o.document_id = d.id AND o.agent_name = ?)`);
    params.push(filters.agent);
  }
  return { where, joins, params };
}

export function listDocuments(db: SqliteDb, filters: DocumentFilters = {}): DocumentListItem[] {
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const ftsQuery = filters.q && isFtsEnabled(db) ? buildFtsMatchQuery(filters.q) : null;
  const { where, joins, params } = buildWhere(filters, ftsQuery);
  const orderBy = ftsQuery ? `rank` : `d.created_at DESC, d.id DESC`;
  const sql = [
    `SELECT ${LIST_COLUMNS}`,
    FROM_JOINS,
    ...joins,
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : ``,
    `ORDER BY ${orderBy}`,
    `LIMIT ? OFFSET ?`,
  ]
    .filter(Boolean)
    .join(" ");
  return db.prepare(sql).all(...params, limit, offset) as DocumentListItem[];
}

export interface SearchHit extends DocumentListItem {
  matched: string[];
}

/**
 * Not + Düzenlenmiş metin + AI çıktılarını kapsayan alan-etiketli arama.
 * FTS varsa üç sanal tabloda ayrı ayrı MATCH, yoksa LIKE fallback çalışır.
 */
export function searchDocuments(db: SqliteDb, filters: DocumentFilters): SearchHit[] {
  const q = filters.q?.trim() ?? "";
  if (!q) return [];
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const ftsEnabled = isFtsEnabled(db);
  const ftsQuery = ftsEnabled ? buildFtsMatchQuery(q) : null;

  const ids = new Set<number>();
  const labels = new Map<number, Set<string>>();

  const addHits = (rows: Array<{ id: number }>, label: string) => {
    for (const row of rows) {
      ids.add(row.id);
      const set = labels.get(row.id) ?? new Set<string>();
      set.add(label);
      labels.set(row.id, set);
    }
  };

  const like = `%${escapeLike(q)}%`;

  if (ftsQuery) {
    addHits(
      db
        .prepare(
          `SELECT d.id FROM documents d JOIN documents_fts fts ON fts.rowid = d.id
           WHERE documents_fts MATCH ? LIMIT 200`,
        )
        .all(ftsQuery) as Array<{ id: number }>,
      "Belge",
    );
    addHits(
      db
        .prepare(
          `SELECT e.document_id AS id FROM document_edits e JOIN document_edits_fts fts ON fts.rowid = e.id
           WHERE document_edits_fts MATCH ? LIMIT 200`,
        )
        .all(ftsQuery) as Array<{ id: number }>,
      "Düzenlenmiş",
    );
    addHits(
      db
        .prepare(
          `SELECT o.document_id AS id FROM document_outputs o JOIN document_outputs_fts fts ON fts.rowid = o.id
           WHERE document_outputs_fts MATCH ? LIMIT 200`,
        )
        .all(ftsQuery) as Array<{ id: number }>,
      "AI çıktısı",
    );
  } else {
    addHits(
      db
        .prepare(
          `SELECT id FROM documents
           WHERE title LIKE ? ESCAPE '\\' OR original_text LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' LIMIT 200`,
        )
        .all(like, like, like) as Array<{ id: number }>,
      "Belge",
    );
    addHits(
      db.prepare(`SELECT document_id AS id FROM document_edits WHERE content LIKE ? ESCAPE '\\' LIMIT 200`).all(like) as Array<{
        id: number;
      }>,
      "Düzenlenmiş",
    );
    addHits(
      db
        .prepare(`SELECT document_id AS id FROM document_outputs WHERE content LIKE ? ESCAPE '\\' LIMIT 200`)
        .all(like) as Array<{ id: number }>,
      "AI çıktısı",
    );
  }

  if (ids.size === 0) return [];

  // FTS eşleşmesinde hangi alanın eşleştiğini saptamak için alan bazlı kontrol.
  const placeholders = Array.from(ids)
    .map(() => "?")
    .join(",");
  const fieldRows = db
    .prepare(
      // Çöpteki dokümanlar arama sonucuna girmez (tek süzgeç: tüm kaynaklar buradan geçer).
      `SELECT id, title, original_text, note FROM documents WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    )
    .all(...ids) as Array<{ id: number; title: string; original_text: string; note: string }>;

  const merged: SearchHit[] = [];
  for (const row of fieldRows) {
    const matched = Array.from(labels.get(row.id) ?? []);
    if (ftsEnabled) {
      const fieldHits: string[] = [];
      if (row.title.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))) fieldHits.push("Başlık");
      if (row.original_text.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))) fieldHits.push("Metin");
      if (row.note.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))) fieldHits.push("Not");
      if (fieldHits.length > 0) matched.push(...fieldHits);
    } else {
      if (row.title.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))) matched.push("Başlık");
      if (row.original_text.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))) matched.push("Metin");
      if (row.note.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))) matched.push("Not");
    }
    merged.push({
      ...getListItem(db, row.id)!,
      matched: Array.from(new Set(matched)),
    });
  }
  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return merged.slice(offset, offset + limit);
}

function getListItem(db: SqliteDb, id: number): DocumentListItem | null {
  const row = db
    .prepare(`SELECT ${LIST_COLUMNS} ${FROM_JOINS} WHERE d.id = ?`)
    .get(id) as DocumentListItem | undefined;
  return row ?? null;
}

export function listDomains(db: SqliteDb): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT source_domain AS domain FROM documents
       WHERE source_domain IS NOT NULL AND deleted_at IS NULL ORDER BY domain`,
    )
    .all() as Array<{ domain: string }>;
  return rows.map((r) => r.domain);
}

/** Okuma durumu; "done" işaretlenince tamamlanma zamanı da yazılır. */
export function setReadState(db: SqliteDb, id: number, state: ReadState): void {
  db.prepare(`UPDATE documents SET read_state = ?, read_at = ?, updated_at = ? WHERE id = ?`).run(
    state,
    state === "done" ? nowIso() : null,
    nowIso(),
    id,
  );
}

export function setFavorite(db: SqliteDb, id: number, favorite: boolean): void {
  db.prepare(`UPDATE documents SET favorite = ?, updated_at = ? WHERE id = ?`).run(favorite ? 1 : 0, nowIso(), id);
}

export function setFolder(db: SqliteDb, id: number, folderId: number | null): void {
  db.prepare(`UPDATE documents SET folder_id = ?, updated_at = ? WHERE id = ?`).run(folderId, nowIso(), id);
}

export function setTitle(db: SqliteDb, id: number, title: string): void {
  db.prepare(`UPDATE documents SET title = ?, updated_at = ? WHERE id = ?`).run(title, nowIso(), id);
}

export function updateNote(db: SqliteDb, id: number, note: string): void {
  const trimmed = note.trim();
  db.prepare(`UPDATE documents SET note = ?, note_updated_at = ?, updated_at = ? WHERE id = ?`).run(
    trimmed,
    trimmed ? nowIso() : null,
    nowIso(),
    id,
  );
}

/** Çöpe taşır (geri alınabilir). Kalıcı silme yok — veri kaybı riski taşımaz. */
export function softDeleteDocument(db: SqliteDb, id: number): boolean {
  const result = db
    .prepare(`UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(nowIso(), nowIso(), id);
  return result.changes > 0;
}

export function restoreDocument(db: SqliteDb, id: number): boolean {
  const result = db
    .prepare(`UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`)
    .run(nowIso(), id);
  return result.changes > 0;
}

/** Kalıcı silme — yalnızca çöpten temizlemek için. */
export function deleteDocument(db: SqliteDb, id: number): void {
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

export function countDocuments(db: SqliteDb): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM documents WHERE deleted_at IS NULL`).get() as { c: number };
  return row.c;
}
