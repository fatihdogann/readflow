import fs from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../src/lib/env";
import { openDatabase, resolveDataDir } from "../src/lib/db/connection";

// WAL ile tutarlı yedek: VACUUM INTO çalışan bağlantıda güvenlidir,
// sqlite dosyasını kopyalamak WAL içeriğini kaçırabilir.
loadLocalEnv();
const db = openDatabase();
const dataDir = resolveDataDir();
const backupDir = path.join(dataDir, "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(backupDir, `readflow-${stamp}.sqlite`);
db.prepare("VACUUM INTO ?").run(target);
console.log(`Yedek alındı: ${target}`);
db.close();
