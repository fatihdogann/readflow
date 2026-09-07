import fs from "node:fs";
import path from "node:path";

/**
 * Worker/MCP/migration gibi Next süreci dışında başlayan girişler için
 * .env / .env.local yükleyici. Dosya adları sabittir; mevcut process.env
 * değerleri asla üzerine yazılmaz (ortam değişkeni önceliği korunur).
 *
 * `READFLOW_ENV_FILE` verilirse (launchd ile kurulan worker servisi bunu
 * kullanır) o dosya da okunur: makineye özgü ayarlar repo dışında durur.
 */
export function loadLocalEnv(startDir = process.cwd()): void {
  const root = path.resolve(startDir);
  const extra = process.env.READFLOW_ENV_FILE?.trim();
  const candidates = [
    path.resolve(root, ".env"),
    path.resolve(root, ".env.local"),
    ...(extra ? [path.resolve(extra)] : []),
  ];
  for (const target of candidates) {
    let content: string;
    try {
      content = fs.readFileSync(target, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) process.env[key] = value;
    }
  }
}
