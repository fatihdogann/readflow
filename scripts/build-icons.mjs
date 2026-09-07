/**
 * Tek kaynaktan (src/app/icon.svg) tüm ikon setini üretir:
 * favicon.ico, apple-icon.png (iOS ana ekran) ve manifest PNG'leri.
 *
 * macOS araçlarıyla çalışır (qlmanage SVG'yi PNG'ye çevirir, sips boyutlandırır);
 * yeni bağımlılık eklemez. İkonlar repoya commit edilir, build sırasında
 * çalıştırılması gerekmez — yalnızca logo değişince: pnpm icons
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "src", "app", "icon.svg");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-icons-"));

const svg = fs.readFileSync(source, "utf8");
const glyph = svg.match(/<path[^>]*\/>/)?.[0];
const background = svg.match(/fill="(#[0-9a-f]{6})"/i)?.[1] ?? "#faf9f7";
if (!glyph) throw new Error("icon.svg içinde <path> bulunamadı");

/** Yuvarlatma yok: iOS kendi maskesini uygular, çift yuvarlatma çirkin durur. */
const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/>${glyph}</svg>`;
/** Maskable: Android ikonun %20'sini kırpabilir, glyph güvenli alana küçültülür. */
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/><g transform="translate(10.9 10.9) scale(0.66)">${glyph}</g></svg>`;

/** SVG → 1024px PNG (qlmanage üretilen dosyayı "<ad>.png" olarak bırakır). */
function renderPng(name, markup) {
  const svgPath = path.join(tmp, `${name}.svg`);
  fs.writeFileSync(svgPath, markup);
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", tmp, svgPath], { stdio: "ignore" });
  const produced = path.join(tmp, `${name}.svg.png`);
  if (!fs.existsSync(produced)) throw new Error(`${name}: PNG üretilemedi (qlmanage)`);
  return produced;
}

function resize(from, to, size) {
  fs.copyFileSync(from, to);
  execFileSync("sips", ["-z", String(size), String(size), to], { stdio: "ignore" });
}

/** PNG'leri ICO kabuğuna sarar (Vista+ PNG-in-ICO); harici araç gerekmez. */
function writeIco(target, pngPaths) {
  const images = pngPaths.map(({ size, file }) => ({ size, data: fs.readFileSync(file) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    entries.push(entry);
  }
  fs.writeFileSync(target, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
}

const base = renderPng("base", svg);
const apple = renderPng("apple", appleSvg);
const maskable = renderPng("maskable", maskableSvg);

const outputs = [
  { file: path.join(root, "public", "icon-192.png"), from: base, size: 192 },
  { file: path.join(root, "public", "icon-512.png"), from: base, size: 512 },
  { file: path.join(root, "public", "icon-maskable-512.png"), from: maskable, size: 512 },
  { file: path.join(root, "src", "app", "apple-icon.png"), from: apple, size: 180 },
];
for (const output of outputs) {
  resize(output.from, output.file, output.size);
  console.log(`✓ ${path.relative(root, output.file)} (${output.size}px)`);
}

const icoSizes = [16, 32, 48].map((size) => {
  const file = path.join(tmp, `ico-${size}.png`);
  resize(base, file, size);
  return { size, file };
});
const icoPath = path.join(root, "src", "app", "favicon.ico");
writeIco(icoPath, icoSizes);
console.log(`✓ ${path.relative(root, icoPath)} (16/32/48px)`);

fs.rmSync(tmp, { recursive: true, force: true });
