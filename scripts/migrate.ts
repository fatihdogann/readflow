import { openDatabase } from "../src/lib/db/connection";
import { getSchemaVersion } from "../src/lib/db/migrations";

const db = openDatabase();
console.log(`Şema sürümü: ${getSchemaVersion(db)}`);
console.log(`Veritabanı: ${process.env.READFLOW_DATA_DIR ?? "~/.readflow"}/readflow.sqlite`);
db.close();
