import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export interface NoteRow {
  id: number;
  title: string;
  content: string;
  folder_id: number | null;
  created_at: string;
  updated_at: string;
  tags: string[];
}

type NoteDbRow = Omit<NoteRow, "tags">;

function getNote(db: SqliteDb, id: number): NoteRow | null {
  const note = db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteDbRow | undefined;
  if (!note) return null;
  const tags = db
    .prepare(`SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE`)
    .all(id) as Array<{ name: string }>;
  return { ...note, tags: tags.map((tag) => tag.name) };
}

export function listNotes(db: SqliteDb): NoteRow[] {
  const rows = db.prepare(`SELECT * FROM notes ORDER BY updated_at DESC, id DESC`).all() as NoteDbRow[];
  return rows.map((row) => getNote(db, row.id)!);
}

export function createNote(db: SqliteDb, input: { title: string; content: string; folderId: number | null }): NoteRow {
  const now = nowIso();
  const result = db
    .prepare(`INSERT INTO notes (title, content, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(input.title.trim(), input.content.trim(), input.folderId, now, now);
  return getNote(db, Number(result.lastInsertRowid))!;
}

export function updateNote(db: SqliteDb, id: number, input: Partial<{ title: string; content: string; folderId: number | null }>): NoteRow | null {
  if (input.title !== undefined) db.prepare(`UPDATE notes SET title = ?, updated_at = ? WHERE id = ?`).run(input.title.trim(), nowIso(), id);
  if (input.content !== undefined) db.prepare(`UPDATE notes SET content = ?, updated_at = ? WHERE id = ?`).run(input.content.trim(), nowIso(), id);
  if (input.folderId !== undefined) db.prepare(`UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?`).run(input.folderId, nowIso(), id);
  return getNote(db, id);
}

export function setNoteTags(db: SqliteDb, noteId: number, names: string[]): NoteRow | null {
  const cleaned = Array.from(new Set(names.map((name) => name.trim()).filter((name) => name.length > 0 && name.length <= 50)));
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_tags WHERE note_id = ?`).run(noteId);
    for (const name of cleaned) {
      const existing = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as { id: number } | undefined;
      const tagId = existing ? existing.id : Number(db.prepare(`INSERT INTO tags (name) VALUES (?)`).run(name).lastInsertRowid);
      db.prepare(`INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)`).run(noteId, tagId);
    }
    db.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run(nowIso(), noteId);
  });
  tx.immediate();
  return getNote(db, noteId);
}
