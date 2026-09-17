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
  {
    id: 10,
    name: "job-snapshot-request-key",
    up: (db) => {
      runAll(db, [
        `DROP INDEX IF EXISTS idx_jobs_active_unique`,
        `ALTER TABLE jobs ADD COLUMN request_key TEXT NOT NULL DEFAULT ''`,
        `UPDATE jobs SET request_key = 'legacy:' || id WHERE request_key = ''`,
        `CREATE UNIQUE INDEX idx_jobs_active_request_unique ON jobs (request_key)
         WHERE status IN ('pending','processing')`,
      ]);
    },
  },
  {
    id: 11,
    name: "job-cancellation",
    up: (db) => {
      runAll(db, [
        // status CHECK kısıtı değiştirilemediği için iptal, failed + cancelled=1 ile temsil edilir;
        // UI bunu hatadan ayırt ederek "İptal edildi" gösterir.
        `ALTER TABLE jobs ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0`,
      ]);
    },
  },
  {
    id: 12,
    name: "document-annotations",
    up: (db) => {
      runAll(db, [
        // Vurgular orijinal/edited içeriğe YAZILMAZ; ayrı tabloda normalize edilmiş
        // metinle eşleşen alıntı + bağlam saklanır.
        `CREATE TABLE document_annotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          content_kind TEXT NOT NULL CHECK (content_kind IN ('original','edited')),
          content_revision INTEGER NOT NULL DEFAULT 0,
          quote TEXT NOT NULL,
          prefix TEXT NOT NULL DEFAULT '',
          suffix TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL CHECK (color IN ('yellow','green','lavender')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX idx_annotations_document ON document_annotations (document_id)`,
      ]);
    },
  },
  {
    id: 13,
    name: "chat-and-jobs-rebuild",
    up: (db) => {
      // jobs.operation CHECK kısıtına 'chat' eklenemeyeceği için tablo
      // birebir yeniden oluşturulur (veri kopyalanır).
      runAll(db, [
        `CREATE TABLE jobs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          operation TEXT NOT NULL CHECK (operation IN ('readability','summary','chat')),
          summary_level TEXT NOT NULL DEFAULT '' CHECK (summary_level IN ('','short','normal','detailed')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          owner TEXT,
          lease_expires_at TEXT,
          source_kind TEXT NOT NULL DEFAULT 'auto',
          source_text TEXT NOT NULL DEFAULT '',
          source_revision INTEGER NOT NULL DEFAULT 0,
          notes_included INTEGER NOT NULL DEFAULT 0,
          notes_text TEXT,
          ai_config TEXT,
          source_images TEXT NOT NULL DEFAULT '[]',
          request_key TEXT NOT NULL DEFAULT '',
          cancelled INTEGER NOT NULL DEFAULT 0,
          cancel_requested INTEGER NOT NULL DEFAULT 0
        )`,
        `INSERT INTO jobs_new
           (id, document_id, operation, summary_level, status, attempts, error, created_at,
            started_at, completed_at, owner, lease_expires_at, source_kind, source_text,
            source_revision, notes_included, notes_text, ai_config, source_images,
            request_key, cancelled, cancel_requested)
         SELECT
            id, document_id, operation, summary_level, status, attempts, error, created_at,
            started_at, completed_at, owner, lease_expires_at, source_kind, source_text,
            source_revision, notes_included, notes_text, ai_config, source_images,
            request_key, cancelled, cancel_requested
         FROM jobs`,
        `DROP TABLE jobs`,
        `ALTER TABLE jobs_new RENAME TO jobs`,
        `CREATE INDEX idx_jobs_status ON jobs (status, created_at)`,
        `CREATE INDEX idx_jobs_document ON jobs (document_id)`,
        `CREATE UNIQUE INDEX idx_jobs_active_request_unique ON jobs (request_key)
         WHERE status IN ('pending','processing')`,
        `CREATE TABLE chat_conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user','assistant')),
          content TEXT NOT NULL,
          source_kind TEXT NOT NULL DEFAULT 'auto',
          source_revision INTEGER NOT NULL DEFAULT 0,
          quote TEXT NOT NULL DEFAULT '',
          include_notes INTEGER NOT NULL DEFAULT 0,
          ai_config TEXT,
          job_id INTEGER,
          status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','queued','processing','completed','failed','cancelled')),
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX idx_chat_messages_conv ON chat_messages (conversation_id, id)`,
      ]);
    },
  },
  {
    id: 14,
    name: "profile-priority-and-effort",
    up: (db) => {
      runAll(db, [
        // Failover sırası artık CLI adına değil bu kolona bakar.
        `ALTER TABLE agent_profiles ADD COLUMN priority INTEGER NOT NULL DEFAULT 100`,
        // Reasoning effort: claude --effort, codex -c model_reasoning_effort.
        // Desteklemeyen CLI'da (jcode) değer saklanır ama argv'ye girmez.
        `ALTER TABLE agent_profiles ADD COLUMN effort TEXT`,
        `UPDATE agent_profiles SET priority = CASE cli
           WHEN 'jcode' THEN 1 WHEN 'codex' THEN 2 WHEN 'claude' THEN 3 ELSE 100 END`,
      ]);
      seedDefaultProfiles(db);
    },
  },
  {
    id: 15,
    name: "document-soft-delete",
    up: (db) => {
      runAll(db, [
        // Silme geri alınabilir olsun: satır durur, listelerden düşer.
        `ALTER TABLE documents ADD COLUMN deleted_at TEXT`,
        `CREATE INDEX idx_documents_deleted ON documents (deleted_at)`,
      ]);
    },
  },
  {
    id: 16,
    name: "document-read-state",
    up: (db) => {
      runAll(db, [
        // Okuma akışı: okunacak / okunuyor / bitti. Varsayılan "unread".
        `ALTER TABLE documents ADD COLUMN read_state TEXT NOT NULL DEFAULT 'unread'
           CHECK (read_state IN ('unread','reading','done'))`,
        `ALTER TABLE documents ADD COLUMN read_at TEXT`,
        `CREATE INDEX idx_documents_read_state ON documents (read_state, updated_at DESC)`,
      ]);
    },
  },
];

/**
 * Varsayılan failover zinciri: jcode → codex → claude. Yalnızca o CLI için hiç
 * profil yoksa eklenir; kullanıcının mevcut profilleri korunur. CLI kurulu
 * olmasa da satır açılır — argv Mac worker'da kendi --help'iyle üretilir.
 */
function seedDefaultProfiles(db: SqliteDb): void {
  const seeds = [
    { name: "jcode · glm-5.3-flash", cli: "jcode", model: "glm-5.3-flash", transport: "argv", effort: null, priority: 1 },
    { name: "codex · gpt-5.6-terra", cli: "codex", model: "gpt-5.6-terra", transport: "stdin", effort: "medium", priority: 2 },
    { name: "claude · opus-5", cli: "claude", model: "opus-5", transport: "stdin", effort: "medium", priority: 3 },
  ];
  const ts = new Date().toISOString();
  const exists = db.prepare(`SELECT 1 FROM agent_profiles WHERE cli = ? LIMIT 1`);
  const insert = db.prepare(
    `INSERT INTO agent_profiles
       (name, cli, model, provider, transport, timeout_ms, effort, priority, config_revision, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 120000, ?, ?, 1, ?, ?)`,
  );
  for (const seed of seeds) {
    if (exists.get(seed.cli)) continue;
    insert.run(seed.name, seed.cli, seed.model, seed.transport, seed.effort, seed.priority, ts, ts);
  }
  // Varsayılan profil yoksa zincirin başını varsayılan yap.
  const current = db.prepare(`SELECT value FROM meta WHERE key = 'default_agent_profile_id'`).get() as
    | { value: string }
    | undefined;
  if (!current) {
    const first = db
      .prepare(`SELECT id FROM agent_profiles WHERE enabled = 1 ORDER BY priority, id LIMIT 1`)
      .get() as { id: number } | undefined;
    if (first) {
      db.prepare(`INSERT INTO meta (key, value) VALUES ('default_agent_profile_id', ?)`).run(String(first.id));
    }
  }
}

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
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
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

/** Bu uygulama sürümünün bildiği en yeni şema. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;

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
