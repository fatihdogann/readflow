import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export interface DocumentEditRow {
  id: number;
  document_id: number;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface SaveEditOutcome {
  edit: DocumentEditRow;
  /** false: revision çakışması — kayıt yapılmadı (optimistic concurrency). */
  applied: boolean;
}

export function getEdit(db: SqliteDb, documentId: number): DocumentEditRow | null {
  const row = db.prepare(`SELECT * FROM document_edits WHERE document_id = ?`).get(documentId) as
    | DocumentEditRow
    | undefined;
  return row ?? null;
}

/**
 * Kullanıcı sürümünü optimistic concurrency ile kaydeder. expectedRevision,
 * mevcut revision ile uyuşmazsa applied=false döner ve taslak istemcide kalır.
 */
export function saveEdit(
  db: SqliteDb,
  documentId: number,
  content: string,
  expectedRevision: number | null,
): SaveEditOutcome {
  const ts = nowIso();
  const tx = db.transaction((): SaveEditOutcome => {
    const existing = getEdit(db, documentId);
    if (!existing) {
      if (expectedRevision !== null && expectedRevision !== 0) {
        return { edit: emptyEdit(documentId), applied: false };
      }
      db
        .prepare(
          `INSERT INTO document_edits (document_id, content, revision, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)`,
        )
        .run(documentId, content, ts, ts);
      return { edit: getEdit(db, documentId)!, applied: true };
    }
    if (expectedRevision === null || expectedRevision !== existing.revision) {
      return { edit: existing, applied: false };
    }
    const result = db
      .prepare(
        `UPDATE document_edits SET content = ?, revision = revision + 1, updated_at = ?
         WHERE document_id = ? AND revision = ?`,
      )
      .run(content, ts, documentId, expectedRevision);
    if (result.changes === 0) return { edit: getEdit(db, documentId)!, applied: false };
    return { edit: getEdit(db, documentId)!, applied: true };
  });
  return tx.immediate();
}

/** Kullanıcı sürümünü kaldırır (açık onay sonrası çağrılır). */
export function deleteEdit(db: SqliteDb, documentId: number): boolean {
  const result = db.prepare(`DELETE FROM document_edits WHERE document_id = ?`).run(documentId);
  return result.changes > 0;
}

function emptyEdit(documentId: number): DocumentEditRow {
  return {
    id: 0,
    document_id: documentId,
    content: "",
    revision: 0,
    created_at: "",
    updated_at: "",
  };
}
