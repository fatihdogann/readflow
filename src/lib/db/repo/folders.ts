import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export interface FolderRow {
  id: number;
  name: string;
  created_at: string;
  document_count: number;
}

export function createFolder(db: SqliteDb, name: string): FolderRow {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Klasör adı boş olamaz");
  const existing = db.prepare(`SELECT * FROM folders WHERE name = ?`).get(trimmed) as
    | { id: number; name: string; created_at: string }
    | undefined;
  if (existing) {
    return { ...existing, document_count: countForFolder(db, existing.id) };
  }
  const result = db
    .prepare(`INSERT INTO folders (name, created_at) VALUES (?, ?)`)
    .run(trimmed, nowIso());
  const id = Number(result.lastInsertRowid);
  return { id, name: trimmed, created_at: nowIso(), document_count: 0 };
}

function countForFolder(db: SqliteDb, folderId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM documents WHERE folder_id = ? AND deleted_at IS NULL`)
    .get(folderId) as { c: number };
  return row.c;
}

export function listFolders(db: SqliteDb): FolderRow[] {
  return db
    .prepare(
      `SELECT f.id, f.name, f.created_at, COUNT(d.id) AS document_count
       FROM folders f LEFT JOIN documents d ON d.folder_id = f.id AND d.deleted_at IS NULL
       GROUP BY f.id ORDER BY f.name COLLATE NOCASE`,
    )
    .all() as FolderRow[];
}

export function deleteFolder(db: SqliteDb, id: number): void {
  db.prepare(`DELETE FROM folders WHERE id = ?`).run(id);
}
