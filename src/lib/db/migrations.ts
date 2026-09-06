import type { SqliteDb } from "./connection";

interface Migration {
  id: number;
  name: string;
  up: (db: SqliteDb) => void;
}

/**
 * Tüm zaman damgaları JS tarafında ISO-8601 (UTC) üretilip parametre olarak bağlanır.
 * Şema sürümü `meta` tablosunda tutulur; her migration transaction içinde uygulanır.
 */
const INIT_STATEMENTS: string[] = [
  `CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL CHECK (source_type IN ('url','text')),
    source_url TEXT,
    source_domain TEXT,
    author TEXT,
    published_at TEXT,
    original_text TEXT NOT NULL DEFAULT '',
    original_html TEXT,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX idx_documents_created ON documents (created_at DESC)`,
  `CREATE INDEX idx_documents_folder ON documents (folder_id)`,
  `CREATE INDEX idx_documents_domain ON documents (source_domain)`,
  `CREATE TABLE document_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('readability','summary')),
    summary_level TEXT NOT NULL DEFAULT '' CHECK (summary_level IN ('','short','normal','detailed')),
    content TEXT NOT NULL,
    agent_name TEXT,
    agent_metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (document_id, operation, summary_level)
  )`,
  `CREATE INDEX idx_outputs_document ON document_outputs (document_id)`,
  `CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('readability','summary')),
    summary_level TEXT NOT NULL DEFAULT '' CHECK (summary_level IN ('','short','normal','detailed')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  )`,
  `CREATE INDEX idx_jobs_status ON jobs (status, created_at)`,
  `CREATE INDEX idx_jobs_document ON jobs (document_id)`,
  `CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  )`,
  `CREATE TABLE document_tags (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
  )`,
  `CREATE INDEX idx_document_tags_tag ON document_tags (tag_id)`,
];

const FTS_STATEMENTS: string[] = [
  `CREATE VIRTUAL TABLE documents_fts USING fts5(title, original_text, content='documents', content_rowid='id')`,
  `CREATE TRIGGER documents_fts_ai AFTER INSERT ON documents BEGIN
     INSERT INTO documents_fts(rowid, title, original_text)
     VALUES (new.id, new.title, new.original_text);
   END`,
  `CREATE TRIGGER documents_fts_ad AFTER DELETE ON documents BEGIN
     INSERT INTO documents_fts(documents_fts, rowid, title, original_text)
     VALUES ('delete', old.id, old.title, old.original_text);
   END`,
  `CREATE TRIGGER documents_fts_au AFTER UPDATE ON documents BEGIN
     INSERT INTO documents_fts(documents_fts, rowid, title, original_text)
     VALUES ('delete', old.id, old.title, old.original_text);
     INSERT INTO documents_fts(rowid, title, original_text)
     VALUES (new.id, new.title, new.original_text);
   END`,
  `INSERT INTO documents_fts(documents_fts) VALUES ('rebuild')`,
];

const FTS_CLEANUP_STATEMENTS: string[] = [
  `DROP TRIGGER IF EXISTS documents_fts_ai`,
  `DROP TRIGGER IF EXISTS documents_fts_ad`,
  `DROP TRIGGER IF EXISTS documents_fts_au`,
  `DROP TABLE IF EXISTS documents_fts`,
];

function runAll(db: SqliteDb, statements: string[]): void {
  for (const statement of statements) {
    db.prepare(statement).run();
  }
}

function setSchemaVersionFlag(db: SqliteDb, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getSchemaVersion(db: SqliteDb): number {
  try {
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : 0;
  } catch {
    return 0; // meta tablosu henüz yok (ilk kurulum)
  }
}

export function runMigrations(db: SqliteDb): void {
  const current = getSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.id <= current) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      setSchemaVersionFlag(db, "schema_version", String(migration.id));
    });
    apply.immediate();
  }
}

export function isFtsEnabled(db: SqliteDb): boolean {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'fts_enabled'`).get() as
    | { value: string }
    | undefined;
  return row?.value === "1";
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "init",
    up: (db) => runAll(db, INIT_STATEMENTS),
  },
  {
    id: 2,
    name: "fts5-search-index",
    up: (db) => {
      try {
        runAll(db, FTS_STATEMENTS);
        setSchemaVersionFlag(db, "fts_enabled", "1");
      } catch {
        // Bu SQLite derlemesinde FTS5 yok: LIKE fallback'i devreye al.
        runAll(db, FTS_CLEANUP_STATEMENTS);
        setSchemaVersionFlag(db, "fts_enabled", "0");
      }
    },
  },
];
