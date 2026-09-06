import fs from "node:fs";
import path from "node:path";
import type { SqliteDb } from "./connection";

interface Migration {
  id: number;
  name: string;
  up: (db: SqliteDb) => void;
}

/**
 * Tüm zaman damgaları JS tarafında ISO-8601 (UTC) üretilip parametre olarak bağlanır.
 * Şema sürümü `meta` tablosunda tutulur; her migration transaction içinde uygulanır.
 * Mevcut migration'lar asla değiştirilmez; yalnızca artan id ile yenisi eklenir.
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

const MIGRATION_4_JOBS_LEASE_SNAPSHOT: string[] = [
  `ALTER TABLE jobs ADD COLUMN owner TEXT`,
  `ALTER TABLE jobs ADD COLUMN lease_expires_at TEXT`,
  `ALTER TABLE jobs ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE jobs ADD COLUMN source_text TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE jobs ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE jobs ADD COLUMN notes_included INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE jobs ADD COLUMN notes_text TEXT`,
  `ALTER TABLE jobs ADD COLUMN ai_config TEXT`,
  // Aynı doküman+operasyon+seviye için yalnızca tek aktif iş: idempotency veritabanı düzeyinde güvence altında.
  `CREATE UNIQUE INDEX idx_jobs_active_unique ON jobs (document_id, operation, summary_level)
   WHERE status IN ('pending','processing')`,
];

const MIGRATION_5_DOCUMENT_EDITS: string[] = [
  `CREATE TABLE document_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

const MIGRATION_6_AGENT_PROFILES: string[] = [
  `CREATE TABLE agent_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cli TEXT NOT NULL CHECK (cli IN ('claude','codex','jcode')),
    model TEXT,
    provider TEXT,
    transport TEXT NOT NULL DEFAULT 'stdin' CHECK (transport IN ('stdin','argv')),
    timeout_ms INTEGER NOT NULL DEFAULT 120000,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    config_revision INTEGER NOT NULL DEFAULT 1,
    capabilities TEXT,
    last_validated_at TEXT,
    last_validation_ok INTEGER CHECK (last_validation_ok IN (0,1)),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

const MIGRATION_7_OUTPUT_REVISIONS: string[] = [
  `CREATE TABLE document_output_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    output_id INTEGER NOT NULL REFERENCES document_outputs(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    summary_level TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    agent_name TEXT,
    agent_metadata TEXT,
    job_id INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX idx_output_revisions_output ON document_output_revisions (output_id, id DESC)`,
];

// FTS v2: nota ek alan, düzenlenmiş metin ve AI çıktıları için ayrı FTS tabloları.
const FTS_V2_DROP: string[] = [
  ...FTS_CLEANUP_STATEMENTS,
  `DROP TRIGGER IF EXISTS document_edits_fts_ai`,
  `DROP TRIGGER IF EXISTS document_edits_fts_ad`,
  `DROP TRIGGER IF EXISTS document_edits_fts_au`,
  `DROP TABLE IF EXISTS document_edits_fts`,
  `DROP TRIGGER IF EXISTS document_outputs_fts_ai`,
  `DROP TRIGGER IF EXISTS document_outputs_fts_ad`,
  `DROP TRIGGER IF EXISTS document_outputs_fts_au`,
  `DROP TABLE IF EXISTS document_outputs_fts`,
];

const FTS_V2_CREATE: string[] = [
  `CREATE VIRTUAL TABLE documents_fts USING fts5(title, original_text, note, content='documents', content_rowid='id')`,
  `CREATE TRIGGER documents_fts_ai AFTER INSERT ON documents BEGIN
     INSERT INTO documents_fts(rowid, title, original_text, note)
     VALUES (new.id, new.title, new.original_text, new.note);
   END`,
  `CREATE TRIGGER documents_fts_ad AFTER DELETE ON documents BEGIN
     INSERT INTO documents_fts(documents_fts, rowid, title, original_text, note)
     VALUES ('delete', old.id, old.title, old.original_text, old.note);
   END`,
  `CREATE TRIGGER documents_fts_au AFTER UPDATE ON documents BEGIN
     INSERT INTO documents_fts(documents_fts, rowid, title, original_text, note)
     VALUES ('delete', old.id, old.title, old.original_text, old.note);
     INSERT INTO documents_fts(rowid, title, original_text, note)
     VALUES (new.id, new.title, new.original_text, new.note);
   END`,
  `CREATE VIRTUAL TABLE document_edits_fts USING fts5(content, content='document_edits', content_rowid='id')`,
  `CREATE TRIGGER document_edits_fts_ai AFTER INSERT ON document_edits BEGIN
     INSERT INTO document_edits_fts(rowid, content) VALUES (new.id, new.content);
   END`,
  `CREATE TRIGGER document_edits_fts_ad AFTER DELETE ON document_edits BEGIN
     INSERT INTO document_edits_fts(document_edits_fts, rowid, content) VALUES ('delete', old.id, old.content);
   END`,
  `CREATE TRIGGER document_edits_fts_au AFTER UPDATE ON document_edits BEGIN
     INSERT INTO document_edits_fts(document_edits_fts, rowid, content) VALUES ('delete', old.id, old.content);
     INSERT INTO document_edits_fts(rowid, content) VALUES (new.id, new.content);
   END`,
  `CREATE VIRTUAL TABLE document_outputs_fts USING fts5(content, content='document_outputs', content_rowid='id')`,
  `CREATE TRIGGER document_outputs_fts_ai AFTER INSERT ON document_outputs BEGIN
     INSERT INTO document_outputs_fts(rowid, content) VALUES (new.id, new.content);
   END`,
  `CREATE TRIGGER document_outputs_fts_ad AFTER DELETE ON document_outputs BEGIN
     INSERT INTO document_outputs_fts(document_outputs_fts, rowid, content) VALUES ('delete', old.id, old.content);
   END`,
  `CREATE TRIGGER document_outputs_fts_au AFTER UPDATE ON document_outputs BEGIN
     INSERT INTO document_outputs_fts(document_outputs_fts, rowid, content) VALUES ('delete', old.id, old.content);
     INSERT INTO document_outputs_fts(rowid, content) VALUES (new.id, new.content);
   END`,
  `INSERT INTO documents_fts(documents_fts) VALUES ('rebuild')`,
  `INSERT INTO document_edits_fts(document_edits_fts) VALUES ('rebuild')`,
  `INSERT INTO document_outputs_fts(document_outputs_fts) VALUES ('rebuild')`,
];

const MIGRATIONS: Migration[] = [
  { id: 1, name: "init", up: (db) => runAll(db, INIT_STATEMENTS) },
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
  {
    id: 3,
    name: "document-note",
    up: (db) => {
      runAll(db, [
        `ALTER TABLE documents ADD COLUMN note TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE documents ADD COLUMN note_updated_at TEXT`,
      ]);
    },
  },
  {
    id: 4,
    name: "jobs-lease-and-snapshot",
    up: (db) => runAll(db, MIGRATION_4_JOBS_LEASE_SNAPSHOT),
  },
  {
    id: 5,
    name: "document-edits",
    up: (db) => runAll(db, MIGRATION_5_DOCUMENT_EDITS),
  },
  {
    id: 6,
    name: "agent-profiles",
    up: (db) => runAll(db, MIGRATION_6_AGENT_PROFILES),
  },
  {
    id: 7,
    name: "output-revisions",
    up: (db) => runAll(db, MIGRATION_7_OUTPUT_REVISIONS),
  },
  {
    id: 8,
    name: "fts-v2-full-coverage",
    up: (db) => {
      try {
        runAll(db, FTS_V2_DROP);
        runAll(db, FTS_V2_CREATE);
        setSchemaVersionFlag(db, "fts_enabled", "1");
      } catch {
        // FTS5 yoksa eski LIKE fallback'i olduğu gibi kullan.
        runAll(db, FTS_V2_DROP);
        setSchemaVersionFlag(db, "fts_enabled", "0");
      }
    },
  },
  {
    id: 9,
    name: "job-source-images",
    up: (db) => {
      runAll(db, [`ALTER TABLE jobs ADD COLUMN source_images TEXT NOT NULL DEFAULT '[]'`]);
    },
  },
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

/**
 * Şema yükseltmesi öncesinde WAL ile tutarlı anlık yedek alır (VACUUM INTO,
 * çalışan bağlantılarla güvenlidir; dosya kopyalamak WAL içeriğini kaçırır).
 * Yedekler <veri dizini>/backups altında birikir ve repo dışında kalır.
 */
export function backupBeforeUpgrade(db: SqliteDb, currentVersion: number, dataDir: string): string | null {
  try {
    const backupDir = path.join(dataDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `pre-upgrade-v${currentVersion}-${stamp}.sqlite`);
    db.prepare("VACUUM INTO ?").run(backupPath);
    return backupPath;
  } catch (error) {
    console.warn(
      "[migration] yedekleme başarısız, yükseltme durdurulmadı:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export function runMigrations(db: SqliteDb, dataDir?: string): void {
  const current = getSchemaVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.id > current);
  if (pending.length === 0) return;
  if (current > 0 && dataDir) {
    const backup = backupBeforeUpgrade(db, current, dataDir);
    if (backup) console.log(`[migration] yükseltme öncesi yedek: ${backup}`);
  }
  for (const migration of pending) {
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

/** FTS5 için "foo bar" -> `"foo"* "bar"*` (prefix araması). */
export function buildFtsMatchQuery(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
}
