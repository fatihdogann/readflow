import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Uzun taramalar tek istekte sonsuza kadar sürmesin. */
const MAX_PAGES = 50;
const PAGE_TIMEOUT_MS = 120_000;

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

/** PDF'in ilk MAX_PAGES sayfasını OCR'lar; sayfalar boş satırla ayrılır. */
export async function ocrPdf(buffer: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-ocr-"));
  try {
    const input = path.join(dir, "input.pdf");
    fs.writeFileSync(input, buffer);
    await run("pdftoppm", ["-r", "200", "-png", "-l", String(MAX_PAGES), input, path.join(dir, "page")], {
      timeout: PAGE_TIMEOUT_MS,
    });
    const pages = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith("page") && name.endsWith(".png"))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    const lang = languages();
    const texts: string[] = [];
    // ponytail: sayfalar sırayla okunur; çok sayfalı taramalarda yavaş, gerekirse paralelleştir.
    for (const page of pages) {
      const { stdout } = await run("tesseract", [path.join(dir, page), "stdout", "-l", lang], {
        timeout: PAGE_TIMEOUT_MS,
        maxBuffer: 10_000_000,
      });
      texts.push(stdout.replace(/[ \t]+/g, " ").trim());
    }
    return texts.filter(Boolean).join("\n\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
