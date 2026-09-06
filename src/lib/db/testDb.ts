import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type SqliteDb } from "./connection";

export interface TestDbHandle {
  db: SqliteDb;
  dataDir: string;
  cleanup: () => void;
}

/** Her test için izole, geçici veri dizininde SQLite oluşturur. */
export function createTestDb(): TestDbHandle {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-test-"));
  const db = openDatabase(dataDir);
  return {
    db,
    dataDir,
    cleanup: () => {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
