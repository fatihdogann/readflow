import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createTestDb } from "./testDb";
import { openDatabase, dbFilePath } from "./connection";
import { insertDocument } from "./repo/documents";
import { getMeta } from "./repo/meta";
import { LATEST_SCHEMA_VERSION } from "./migrations";
import { backupStatus, createBackup, inspectArchive, restoreArchive } from "./backup";
import { InputError } from "../types";

describe("arşiv yedeği", () => {
  it("yedek alır, doğrular ve başka veri dizinine aynı sayılarla geri yükler", () => {
    const source = createTestDb();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-restore-"));
    try {
      expect(backupStatus(source.db).stale).toBe(true);
      insertDocument(source.db, { title: "Bir", sourceType: "text", originalText: "birinci belge" });
      insertDocument(source.db, { title: "İki", sourceType: "text", originalText: "ikinci belge" });

      const file = createBackup(source.db, source.dataDir);
      expect(fs.existsSync(file)).toBe(true);
      expect(getMeta(source.db, "last_backup_at")).toBeTruthy();
      expect(backupStatus(source.db).stale).toBe(false);
      expect(backupStatus(source.db, Date.now() + 8 * 24 * 3600 * 1000).stale).toBe(true);

      const report = inspectArchive(file);
      expect(report.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(report.counts.documents).toBe(2);

      // Hedefte önceden bir veri varsa üzerine yazılmadan önce yedeklenir
      const existing = openDatabase(targetDir);
      insertDocument(existing, { title: "Eski", sourceType: "text", originalText: "eski" });
      existing.close();

      const result = restoreArchive(file, targetDir);
      expect(result.safetyBackup).not.toBeNull();
      expect(inspectArchive(result.safetyBackup!).counts.documents).toBe(1);
      expect(result.after.counts).toEqual(report.counts);

      const restored = openDatabase(targetDir);
      const titles = restored.prepare(`SELECT title FROM documents ORDER BY id`).all() as Array<{ title: string }>;
      restored.close();
      expect(titles.map((row) => row.title)).toEqual(["Bir", "İki"]);
    } finally {
      source.cleanup();
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  it("SQLite olmayan veya Readflow'a ait olmayan dosyayı reddeder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-bad-"));
    try {
      const text = path.join(dir, "not.sqlite");
      fs.writeFileSync(text, "merhaba");
      expect(() => inspectArchive(text)).toThrow(InputError);

      const foreign = path.join(dir, "foreign.sqlite");
      const db = new Database(foreign);
      db.exec(`CREATE TABLE x (id INTEGER)`);
      db.close();
      expect(() => inspectArchive(foreign)).toThrow(/Readflow/);
      expect(() => restoreArchive(foreign, dir)).toThrow(InputError);
      expect(fs.existsSync(dbFilePath(dir))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uygulamadan yeni şema sürümlü arşivi reddeder", () => {
    const source = createTestDb();
    try {
      const file = createBackup(source.db, source.dataDir);
      const db = new Database(file);
      db.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run(String(LATEST_SCHEMA_VERSION + 1));
      db.close();
      expect(() => restoreArchive(file, fs.mkdtempSync(path.join(os.tmpdir(), "readflow-new-")))).toThrow(/yeni/);
    } finally {
      source.cleanup();
    }
  });
});
