import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Uzun taramalar tek istekte sonsuza kadar sürmesin; READFLOW_OCR_MAX_PAGES ile değişir. */
const DEFAULT_MAX_PAGES = 50;
const PAGE_TIMEOUT_MS = 120_000;

/**
 * Kaç sayfa aynı anda okunur. Varsayılan: çekirdeklerin yarısı (en çok 4) —
 * makineyi boğmamak için bilinçli olarak muhafazakâr. READFLOW_OCR_CONCURRENCY
 * ile değişir; her tesseract süreci ayrıca tek iş parçacığına sabitlenir.
 */
export function ocrConcurrency(): number {
  const raw = Number(process.env.READFLOW_OCR_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
}

export function ocrMaxPages(): number {
  const raw = Number(process.env.READFLOW_OCR_MAX_PAGES);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_MAX_PAGES;
  return Math.floor(raw);
}

/**
 * Yerel OCR: poppler (`pdftoppm`) sayfaları görsele çevirir, `tesseract` okur.
 * İkisi de sistem CLI'ı; npm bağımlılığı yok, veri makineden çıkmaz.
 * `READFLOW_OCR=off` ile kapatılır.
 */
export function ocrAvailable(): boolean {
  if (process.env.READFLOW_OCR?.trim().toLowerCase() === "off") return false;
  return ["pdftoppm", "tesseract"].every(
    (bin) => spawnSync(bin, ["-v"], { stdio: "ignore", timeout: 5000 }).error === undefined,
  );
}

/** Kurulu dillerden istenenleri seçer (varsayılan Türkçe + İngilizce). */
function languages(): string {
  const wanted = (process.env.READFLOW_OCR_LANG?.trim() || "tur+eng").split("+");
  const listed = spawnSync("tesseract", ["--list-langs"], { encoding: "utf8", timeout: 5000 });
  const installed = new Set(`${listed.stdout ?? ""}`.split(/\s+/));
  const usable = wanted.filter((lang) => installed.has(lang));
  return usable.length > 0 ? usable.join("+") : "eng";
}

export const OCR_INSTALL_HINT =
  "OCR için tesseract ve poppler gerekli (macOS: brew install tesseract tesseract-lang poppler; " +
  "Debian/Ubuntu: apt install tesseract-ocr tesseract-ocr-tur poppler-utils).";

/** PDF'in ilk `ocrMaxPages()` sayfasını OCR'lar; sayfalar boş satırla ayrılır. */
export async function ocrPdf(buffer: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-ocr-"));
  try {
    const input = path.join(dir, "input.pdf");
    fs.writeFileSync(input, buffer);
    const maxPages = ocrMaxPages();
    // Dönüştürme tüm sayfaları tek seferde yapar: süre sayfa sayısıyla ölçeklenir.
    await run("pdftoppm", ["-r", "200", "-png", "-l", String(maxPages), input, path.join(dir, "page")], {
      timeout: 60_000 + maxPages * 4_000,
    });
    const pages = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith("page") && name.endsWith(".png"))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    const lang = languages();
    const texts: string[] = new Array(pages.length).fill("");
    const limit = ocrConcurrency();
    let next = 0;
    // Sayfalar sıralı kuyruktan çekilir; aynı anda en çok `limit` tesseract çalışır.
    const worker = async (): Promise<void> => {
      for (let index = next++; index < pages.length; index = next++) {
        const { stdout } = await run("tesseract", [path.join(dir, pages[index]), "stdout", "-l", lang], {
          timeout: PAGE_TIMEOUT_MS,
          maxBuffer: 10_000_000,
          // tesseract kendi içinde de iş parçacığı açar; paralel çalışırken tek çekirdeğe sabitle.
          env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        });
        texts[index] = stdout.replace(/[ \t]+/g, " ").trim();
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, pages.length) }, worker));
    return texts.filter(Boolean).join("\n\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
