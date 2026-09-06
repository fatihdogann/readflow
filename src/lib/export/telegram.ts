import { request as httpsRequest } from "node:https";
import type { ExportPayload, RemoteExportResult, RemoteExporter } from "./types";

const TELEGRAM_LIMIT = 3900;
const TELEGRAM_HOST = "api.telegram.org";

interface SendOutcome {
  ok: boolean;
  status: number;
  detail?: string;
}

/**
 * Telegram Bot API çağrısı: host sabittir; token yalnızca Telegram'ın izin
 * verdiği karakterleri içerecek biçimde temizlenir ve istek node:https ile,
 * sabit hostname'e karşı yapılır.
 */
function sendMessage(safeToken: string, chatId: string, text: string): Promise<SendOutcome> {
  return new Promise((resolve) => {
    const pathSegment = "/bot" + safeToken + "/sendMessage";
    const body = JSON.stringify({ chat_id: chatId, text });
    const request = httpsRequest(
      {
        hostname: TELEGRAM_HOST,
        port: 443,
        path: pathSegment,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 15_000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseBody += chunk;
          if (responseBody.length > 20_000) responseBody = responseBody.slice(0, 20_000);
        });
        response.on("end", () => {
          resolve({
            ok: (response.statusCode ?? 500) < 400,
            status: response.statusCode ?? 0,
            detail: (response.statusCode ?? 500) < 400 ? undefined : responseBody.slice(0, 300),
          });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("Telegram isteği zaman aşımına uğradı"));
    });
    request.on("error", (error: Error) => {
      resolve({ ok: false, status: 0, detail: error.message });
    });
    request.write(body);
    request.end();
  });
}

export class TelegramExporter implements RemoteExporter {
  readonly id = "telegram" as const;

  isConfigured(): boolean {
    return Boolean(
      process.env.READFLOW_TELEGRAM_BOT_TOKEN?.trim() && process.env.READFLOW_TELEGRAM_CHAT_ID?.trim(),
    );
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!process.env.READFLOW_TELEGRAM_BOT_TOKEN?.trim()) missing.push("READFLOW_TELEGRAM_BOT_TOKEN");
    if (!process.env.READFLOW_TELEGRAM_CHAT_ID?.trim()) missing.push("READFLOW_TELEGRAM_CHAT_ID");
    return missing;
  }

  async export(payload: ExportPayload): Promise<RemoteExportResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        message: `Telegram entegrasyonu kurulmadı. .env.local içine şunları ekleyin: ${this.missingConfig().join(", ")}`,
      };
    }
    // Bot token biçimi: <sayılar>:<harf/rakam/_/->. Path'e girmeden temizlenir.
    const rawToken = process.env.READFLOW_TELEGRAM_BOT_TOKEN!.trim();
    const safeToken = rawToken.replace(/[^0-9A-Za-z:_-]/g, "");
    if (safeToken !== rawToken) {
      return { ok: false, message: "READFLOW_TELEGRAM_BOT_TOKEN beklenmeyen karakterler içeriyor" };
    }
    const chatId = process.env.READFLOW_TELEGRAM_CHAT_ID!.trim();

    const { document, output } = payload;
    const content = output ? output.content : document.original_text;
    const header = `📄 ${document.title}${document.source_url ? `\n${document.source_url}` : ""}\n\n`;
    const full = header + content.trim();

    // Bot API mesaj başına 4096 karakter sınırı koyar.
    const chunks: string[] = [];
    for (let start = 0; start < full.length; start += TELEGRAM_LIMIT) {
      chunks.push(full.slice(start, start + TELEGRAM_LIMIT));
    }
    for (const chunk of chunks) {
      const outcome = await sendMessage(safeToken, chatId, chunk);
      if (!outcome.ok) {
        return { ok: false, message: `Telegram hatası (HTTP ${outcome.status}): ${outcome.detail ?? ""}` };
      }
    }
    return { ok: true, message: `Telegram'a gönderildi (${chunks.length} mesaj).` };
  }
}
