import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export type AnnotationColor = "yellow" | "green" | "lavender";
export type AnnotationContentKind = "original" | "edited";

export interface AnnotationRow {
  id: number;
  document_id: number;
  content_kind: AnnotationContentKind;
  content_revision: number;
  quote: string;
  prefix: string;
  suffix: string;
  note: string;
  color: AnnotationColor;
  created_at: string;
  updated_at: string;
}

export function listAnnotations(db: SqliteDb, documentId: number): AnnotationRow[] {
  return db
    .prepare(`SELECT * FROM document_annotations WHERE document_id = ? ORDER BY id`)
    .all(documentId) as AnnotationRow[];
}

/** Arşiv görünümü için belge bilgisiyle zenginleştirilmiş vurgu. */
export interface AnnotationWithDocument extends AnnotationRow {
  document_title: string;
  document_domain: string | null;
  document_source_url: string | null;
}

export interface AnnotationQuery {
  color?: AnnotationColor;
  /** Alıntı veya notta geçen metin. */
  q?: string;
  /** Yalnız notu olan vurgular. */
  withNote?: boolean;
  documentId?: number;
  limit?: number;
  offset?: number;
}

/**
 * Tüm belgelerdeki vurgular, en yeniden eskiye.
 * Silinmiş (çöpteki) belgelerin vurguları listelenmez.
 */
export function listAllAnnotations(db: SqliteDb, query: AnnotationQuery = {}): AnnotationWithDocument[] {
  const where: string[] = ["d.deleted_at IS NULL"];
  const params: Array<string | number> = [];

  if (query.color) {
    where.push(`a.color = ?`);
    params.push(query.color);
  }
  if (query.documentId) {
    where.push(`a.document_id = ?`);
    params.push(query.documentId);
  }
  if (query.withNote) where.push(`a.note != ''`);
  if (query.q?.trim()) {
    where.push(`(a.quote LIKE ? ESCAPE '\\' OR a.note LIKE ? ESCAPE '\\')`);
    const like = `%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }

  return db
    .prepare(
      `SELECT a.*, d.title AS document_title, d.source_domain AS document_domain,
              d.source_url AS document_source_url
       FROM document_annotations a
       JOIN documents d ON d.id = a.document_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, Math.min(query.limit ?? 100, 500), Math.max(query.offset ?? 0, 0)) as AnnotationWithDocument[];
}

export interface CreateAnnotationInput {
  documentId: number;
  contentKind: AnnotationContentKind;
  contentRevision: number;
  quote: string;
  prefix?: string;
  suffix?: string;
  color: AnnotationColor;
  note?: string;
}

export function createAnnotation(db: SqliteDb, input: CreateAnnotationInput): AnnotationRow {
  const ts = nowIso();
  const result = db
    .prepare(
      `INSERT INTO document_annotations
         (document_id, content_kind, content_revision, quote, prefix, suffix, note, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.documentId,
      input.contentKind,
      input.contentRevision,
      input.quote.slice(0, 2000),
      (input.prefix ?? "").slice(-120),
      (input.suffix ?? "").slice(0, 120),
      input.note ?? "",
      input.color,
      ts,
      ts,
    );
  return getAnnotation(db, Number(result.lastInsertRowid))!;
}

export function getAnnotation(db: SqliteDb, id: number): AnnotationRow | null {
  const row = db.prepare(`SELECT * FROM document_annotations WHERE id = ?`).get(id) as
    | AnnotationRow
    | undefined;
  return row ?? null;
}

export function updateAnnotation(
  db: SqliteDb,
  id: number,
  patch: { note?: string; color?: AnnotationColor },
): AnnotationRow | null {
  const current = getAnnotation(db, id);
  if (!current) return null;
  db.prepare(
    `UPDATE document_annotations SET note = ?, color = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.note !== undefined ? patch.note : current.note,
    patch.color ?? current.color,
    nowIso(),
    id,
  );
  return getAnnotation(db, id);
}

export function deleteAnnotation(db: SqliteDb, id: number): boolean {
  return db.prepare(`DELETE FROM document_annotations WHERE id = ?`).run(id).changes > 0;
}
