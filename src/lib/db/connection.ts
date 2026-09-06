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

export function openDatabase(dataDir = resolveDataDir()): SqliteDb {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbFilePath(dataDir));
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
