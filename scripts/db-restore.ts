import path from "node:path";
import { loadLocalEnv } from "../src/lib/env";
import { dbFilePath, openDatabase, resolveDataDir } from "../src/lib/db/connection";
import { inspectArchive, restoreArchive } from "../src/lib/db/backup";
import { isHeartbeatFresh, readHeartbeat } from "../src/lib/jobs/worker";
import fs from "node:fs";

// Kullanım: pnpm db:restore <arşiv.sqlite> [--check]
//   --check  yalnızca arşivi doğrular ve sayıları yazar, hiçbir şeyi değiştirmez.
loadLocalEnv();
const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
if (!file) {
  console.error("kullanım: pnpm db:restore <arşiv.sqlite> [--check]");
  process.exit(1);
}
const archive = path.resolve(file);

try {
  const report = inspectArchive(archive);
  console.log(`Arşiv: ${archive}`);
  console.log(`Şema ${report.schemaVersion} ·`, report.counts);
  if (args.includes("--check")) process.exit(0);

  const dataDir = resolveDataDir();
  if (fs.existsSync(dbFilePath(dataDir))) {
    const db = openDatabase(dataDir);
    const alive = isHeartbeatFresh(readHeartbeat(db));
    db.close();
    if (alive) {
      console.error("hata: worker çalışıyor. Önce durdur: pnpm app:uninstall (veya dev süreçlerini kapat)");
      process.exit(1);
    }
  }

  const result = restoreArchive(archive, dataDir);
  if (result.safetyBackup) console.log(`Önceki veritabanı yedeklendi: ${result.safetyBackup}`);
  console.log(`Geri yüklendi: ${dbFilePath(dataDir)} (şema ${result.after.schemaVersion})`);
  console.log("Sayılar eşleşti ✓", result.after.counts);
} catch (error) {
  console.error(`hata: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
