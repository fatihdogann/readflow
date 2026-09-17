import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

export type SqliteDb = Database.Database;

export function resolveDataDir(): string {
  const fromEnv = process.env.READFLOW_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".readflow");
}

export function dbFilePath(dataDir = resolveDataDir()): string {
  return path.join(dataDir, "readflow.sqlite");
}

/** Veri dizini yalnız sahibine açık (0700); Windows'ta mode yok sayılır. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
}

export function openDatabase(dataDir = resolveDataDir()): SqliteDb {
  ensurePrivateDir(dataDir);
  const file = dbFilePath(dataDir);
  const db = new Database(file);
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  runMigrations(db, dataDir);
  return db;
}

const store = globalThis as unknown as {
  __readflowDb?: SqliteDb;
  __readflowTestDb?: SqliteDb;
};

/**
 * Web/worker/MCP süreçleri bu tek bağlantıyı paylaşır.
 * Testler `__readflowTestDb` üzerinden geçici bir DB enjekte eder.
 */
export function getDb(): SqliteDb {
  if (store.__readflowTestDb) return store.__readflowTestDb;
  if (!store.__readflowDb) store.__readflowDb = openDatabase();
  return store.__readflowDb;
}
