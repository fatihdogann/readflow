import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dbFilePath, ensurePrivateDir, openDatabase, type SqliteDb } from "./connection";
import { LATEST_SCHEMA_VERSION } from "./migrations";
import { getMeta, setMeta } from "./repo/meta";
import { InputError } from "../types";

export const LAST_BACKUP_KEY = "last_backup_at";

/** Geri yüklemede karşılaştırılan tablolar (kullanıcı verisi taşıyanlar). */
const COUNTED_TABLES = [
  "documents",
  "document_edits",
  "document_outputs",
  "document_output_revisions",
  "document_annotations",
  "jobs",
  "folders",
  "tags",
  "chat_messages",
] as const;

const BACKUP_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Son yedek zamanı ve 7 günden eski olup olmadığı (hiç yedek yoksa eski sayılır). */
export function backupStatus(db: SqliteDb, now = Date.now()): { lastBackupAt: string | null; stale: boolean } {
  const lastBackupAt = getMeta(db, LAST_BACKUP_KEY);
  const age = lastBackupAt ? now - new Date(lastBackupAt).getTime() : Infinity;
  return { lastBackupAt, stale: age > BACKUP_STALE_MS };
}

export interface ArchiveReport {
  schemaVersion: number;
  counts: Record<string, number>;
}

/**
 * WAL ile tutarlı tam arşiv: VACUUM INTO çalışan bağlantıda güvenlidir.
 * Dosya <veri dizini>/backups altına 0600 izinle yazılır.
 */
export function createBackup(db: SqliteDb, dataDir: string, prefix = "readflow"): string {
  const backupDir = path.join(dataDir, "backups");
  ensurePrivateDir(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `${prefix}-${stamp}.sqlite`);
  db.prepare("VACUUM INTO ?").run(target);
  if (process.platform !== "win32") fs.chmodSync(target, 0o600);
  setMeta(db, LAST_BACKUP_KEY, new Date().toISOString());
  return target;
}

/** Arşivi salt-okunur açar; bütünlük, Readflow şeması ve tablo sayılarını döndürür. */
export function inspectArchive(file: string): ArchiveReport {
  let db: SqliteDb;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    throw new InputError(`Arşiv açılamadı: ${file}`);
  }
  try {
    let integrity: string;
    try {
      integrity = String(db.pragma("integrity_check", { simple: true }));
    } catch {
      throw new InputError("Dosya geçerli bir SQLite veritabanı değil");
    }
    if (integrity !== "ok") throw new InputError(`Arşiv bozuk: ${integrity}`);

    const tables = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    if (!tables.has("meta") || !tables.has("documents")) {
      throw new InputError("Bu dosya bir Readflow arşivi değil");
    }
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    const counts: Record<string, number> = {};
    for (const table of COUNTED_TABLES) {
      if (!tables.has(table)) continue;
      counts[table] = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    }
    return { schemaVersion: Number(version?.value ?? 0), counts };
  } finally {
    db.close();
  }
}

export interface RestoreResult {
  before: ArchiveReport;
  after: ArchiveReport;
  /** Üzerine yazılan mevcut veritabanının yedeği (yoksa null). */
  safetyBackup: string | null;
}

/**
 * Arşivi veri dizinine geri yükler. Uygulama ve worker KAPALI olmalıdır
 * (çağıran taraf denetler). Mevcut veritabanı önce yedeklenir; eski şemalı
 * arşiv açılışta migration ile yükseltilir, ardından sayılar karşılaştırılır.
 */
export function restoreArchive(file: string, dataDir: string): RestoreResult {
  const before = inspectArchive(file);
  if (before.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new InputError(
      `Arşiv bu uygulamadan yeni (şema ${before.schemaVersion} > ${LATEST_SCHEMA_VERSION}); önce Readflow'u güncelle`,
    );
  }

  ensurePrivateDir(dataDir);
  const target = dbFilePath(dataDir);
  let safetyBackup: string | null = null;
  if (fs.existsSync(target)) {
    const current = openDatabase(dataDir);
    try {
      safetyBackup = createBackup(current, dataDir, "pre-restore");
    } finally {
      current.close();
    }
  }

  // Aynı dizinde geçici kopya + rename: yarım kalan kopya asıl dosyayı bozmaz.
  const temp = `${target}.restore-tmp`;
  fs.copyFileSync(file, temp);
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${target}${suffix}`, { force: true });
  fs.renameSync(temp, target);

  const db = openDatabase(dataDir);
  db.close();
  const after = inspectArchive(target);
  for (const [table, count] of Object.entries(before.counts)) {
    if (after.counts[table] !== count) {
      throw new Error(`Doğrulama başarısız: ${table} ${count} → ${after.counts[table]}`);
    }
  }
  return { before, after, safetyBackup };
}
