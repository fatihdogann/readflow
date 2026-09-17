import { loadLocalEnv } from "../src/lib/env";
import { openDatabase } from "../src/lib/db/connection";
import { importPaths } from "../src/lib/import";

// Kullanım: pnpm import:files <dosya|klasör>...
//   Belgeler: .md .txt .html .pdf .docx (taranmış PDF'ler yerel OCR ile)
//   Bağlantı listeleri: url sütunlu CSV (Instapaper, Pocket, Readwise…), Netscape yer imi HTML'i
loadLocalEnv();
const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("kullanım: pnpm import:files <dosya|klasör>...");
  process.exit(1);
}

async function main(): Promise<void> {
  const db = openDatabase();
  try {
    const result = await importPaths(db, targets, { onProgress: (line) => console.log(line) });
    console.log(`\nEklendi: ${result.created} · Atlandı: ${result.skipped} · Hata: ${result.failed.length}`);
    for (const failure of result.failed) console.log(`  ✗ ${failure.item} — ${failure.error}`);
    process.exitCode = result.failed.length > 0 ? 2 : 0;
  } finally {
    db.close();
  }
}

void main();
