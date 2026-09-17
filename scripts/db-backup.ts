import { loadLocalEnv } from "../src/lib/env";
import { openDatabase, resolveDataDir } from "../src/lib/db/connection";
import { createBackup, inspectArchive } from "../src/lib/db/backup";

// WAL ile tutarlı tam arşiv (VACUUM INTO); dosya kopyalamak WAL içeriğini kaçırabilir.
loadLocalEnv();
const db = openDatabase();
const target = createBackup(db, resolveDataDir());
db.close();
const report = inspectArchive(target);
console.log(`Yedek alındı: ${target}`);
console.log(`Şema ${report.schemaVersion} ·`, report.counts);
