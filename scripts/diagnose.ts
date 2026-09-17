import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { loadLocalEnv } from "../src/lib/env";
import { dbFilePath, resolveDataDir } from "../src/lib/db/connection";
import { LATEST_SCHEMA_VERSION } from "../src/lib/db/migrations";
import { backupStatus } from "../src/lib/db/backup";
import { resolveAdapter } from "../src/lib/agent";
import { OCR_INSTALL_HINT, ocrAvailable } from "../src/lib/extraction/ocr";

// Salt-okunur kurulum denetimi: hiçbir dosyayı değiştirmez, secret değerlerini yazdırmaz.
// Kullanım: pnpm diagnose

const appEnv = path.join(resolveDataDir(), "app.env");
if (!process.env.READFLOW_ENV_FILE && fs.existsSync(appEnv)) process.env.READFLOW_ENV_FILE = appEnv;
loadLocalEnv();

let failures = 0;
const ok = (msg: string) => console.log(`✓ ${msg}`);
const warn = (msg: string) => console.log(`! ${msg}`);
const fail = (msg: string) => {
  failures++;
  console.log(`✗ ${msg}`);
};

function checkRuntime(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} — 22 veya üstü gerekli`);

  const pnpm = spawnSync("pnpm", ["-v"], { encoding: "utf8", shell: process.platform === "win32" });
  if (pnpm.status === 0) ok(`pnpm ${pnpm.stdout.trim()}`);
  else fail("pnpm bulunamadı — corepack enable");

  if (fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) ok("Production build var");
  else warn("Production build yok — pnpm build (yalnız app:start için gerekli)");
}

function checkData(): void {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) {
    warn(`Veri dizini yok: ${dir} (ilk açılışta oluşur)`);
    return;
  }
  const mode = fs.statSync(dir).mode & 0o777;
  if (process.platform === "win32" || mode === 0o700) ok(`Veri dizini: ${dir}`);
  else warn(`Veri dizini izinleri ${mode.toString(8)} — 700 önerilir (uygulama açılışta düzeltir)`);

  const file = dbFilePath(dir);
  if (!fs.existsSync(file)) {
    warn("Veritabanı henüz yok (ilk açılışta oluşur)");
    return;
  }
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const check = String(db.pragma("quick_check", { simple: true }));
      if (check !== "ok") fail(`Veritabanı bütünlüğü: ${check}`);
      const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
      const version = Number(row?.value ?? 0);
      if (version > LATEST_SCHEMA_VERSION) fail(`Şema ${version} bu koddan yeni (${LATEST_SCHEMA_VERSION}) — git pull`);
      else if (version < LATEST_SCHEMA_VERSION) warn(`Şema ${version} → ${LATEST_SCHEMA_VERSION} (açılışta yükseltilir)`);
      else ok(`Veritabanı sağlam, şema ${version}`);
      const count = (db.prepare(`SELECT COUNT(*) AS c FROM documents WHERE deleted_at IS NULL`).get() as { c: number }).c;
      ok(`${count} belge`);
      const backup = backupStatus(db);
      if (backup.stale) warn(`Son yedek: ${backup.lastBackupAt ?? "hiç"} — pnpm db:backup`);
      else ok(`Son yedek: ${backup.lastBackupAt}`);
    } finally {
      db.close();
    }
  } catch (error) {
    fail(`Veritabanı açılamadı: ${error instanceof Error ? error.message : error}`);
  }
}

function checkAuth(): void {
  const user = process.env.READFLOW_AUTH_USERNAME?.trim();
  const pass = process.env.READFLOW_AUTH_PASSWORD?.trim() ?? "";
  const secret = process.env.READFLOW_SESSION_SECRET?.trim() ?? "";
  if (!user && !pass) {
    warn("Giriş yapılandırılmamış — yerel geliştirmede sorun değil, app:start için zorunlu");
  } else {
    if (user && pass.length >= 10) ok("Giriş bilgileri tanımlı");
    else fail("READFLOW_AUTH_USERNAME boş veya parola 10 karakterden kısa");
    if (secret.length >= 32) ok("READFLOW_SESSION_SECRET tanımlı");
    else fail("READFLOW_SESSION_SECRET eksik veya 32 karakterden kısa");
  }
  if (process.env.READFLOW_SERVER_URL || process.env.READFLOW_WORKER_TOKEN) {
    warn("Uzak worker değişkenleri tanımlı (READFLOW_SERVER_URL/WORKER_TOKEN) — yerel kurulumda gereksiz");
  }
}

function checkTools(): void {
  const { adapter, info } = resolveAdapter();
  if (adapter) ok(`Agent: ${info.command ?? info.mode}${info.source ? ` [${info.source}]` : ""}`);
  else warn(`Agent bulunamadı — AI işleri bekler. ${info.message ?? "claude / codex / jcode kur ve oturum aç"}`);

  if (ocrAvailable()) ok("OCR: tesseract + pdftoppm");
  else warn(`OCR yok — taranmış PDF'ler eklenemez. ${OCR_INSTALL_HINT}`);

  if (process.platform === "darwin") {
    const service = spawnSync("launchctl", ["print", `gui/${os.userInfo().uid}/com.readflow.app`], { stdio: "ignore" });
    if (service.status === 0) ok("launchd servisi kurulu (com.readflow.app)");
    else warn("launchd servisi kurulu değil — pnpm app:install");
  }
}

async function checkHealth(): Promise<void> {
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (response.ok) ok(`Sağlık ucu yanıt veriyor: ${url}`);
    else fail(`Sağlık ucu ${response.status} döndü: ${url}`);
  } catch {
    warn(`Uygulama çalışmıyor: ${url}`);
  }
}

async function main(): Promise<void> {
  checkRuntime();
  checkData();
  checkAuth();
  checkTools();
  await checkHealth();
  console.log(failures ? `\n${failures} sorun bulundu.` : "\nSorun bulunmadı.");
  process.exitCode = failures ? 1 : 0;
}

void main();
