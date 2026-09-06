import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export interface TagRow {
  id: number;
  name: string;
  document_count: number;
}

function getOrCreateTag(db: SqliteDb, name: string): number {
  const trimmed = name.trim();
  const existing = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(trimmed) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const result = db.prepare(`INSERT INTO tags (name) VALUES (?)`).run(trimmed);
  return Number(result.lastInsertRowid);
}

/** Dokümanın etiketlerini verilen listeyle değiştirir. */
export function setDocumentTags(db: SqliteDb, documentId: number, names: string[]): string[] {
  const cleaned = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0 && n.length <= 50)),
  );
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM document_tags WHERE document_id = ?`).run(documentId);
    for (const name of cleaned) {
      const tagId = getOrCreateTag(db, name);
      db.prepare(
        `INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)`,
      ).run(documentId, tagId);
    }
    db.prepare(`UPDATE documents SET updated_at = ? WHERE id = ?`).run(nowIso(), documentId);
  });
  tx.immediate();
  return cleaned;
}

export function listDocumentTags(db: SqliteDb, documentId: number): string[] {
  const rows = db
    .prepare(
      `SELECT t.name FROM tags t JOIN document_tags dt ON dt.tag_id = t.id
       WHERE dt.document_id = ? ORDER BY t.name COLLATE NOCASE`,
    )
    .all(documentId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function listTags(db: SqliteDb): TagRow[] {
  return db
    .prepare(
      `SELECT t.id, t.name, COUNT(dt.document_id) AS document_count
       FROM tags t LEFT JOIN document_tags dt ON dt.tag_id = t.id
       GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    )
    .all() as TagRow[];
}
