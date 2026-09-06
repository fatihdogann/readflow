import { request as httpsRequest } from "node:https";
import type { ExportPayload, RemoteExportResult, RemoteExporter } from "./types";
import { payloadContent } from "./content";

const TELEGRAM_LIMIT = 3900;
const TELEGRAM_HOST = "api.telegram.org";

interface SendOutcome {
  ok: boolean;
  status: number;
  description?: string;
  retryAfter?: number;
}

/**
 * Telegram yanıtının `ok` alanını ve hata açıklamasını ayrıştırır:
 * yetki/chat hatası, hız sınırı (retry_after) ve HTTP durumu ayrı bildirilir.
 */
function parseSendOutcome(status: number, body: string): SendOutcome {
  try {
    const parsed = JSON.parse(body) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } };
    if (parsed.ok === false) {
      return {
        ok: false,
        status,
        description: parsed.description ?? "bilinmeyen Telegram hatası",
        retryAfter: parsed.parameters?.retry_after,
      };
    }
  } catch {
    /* JSON değil */
  }
  return { ok: status < 400, status, description: status < 400 ? undefined : body.slice(0, 200) };
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
          resolve(parseSendOutcome(response.statusCode ?? 500, responseBody));
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("Telegram isteği zaman aşımına uğradı"));
    });
    request.on("error", (error: Error) => {
      resolve({ ok: false, status: 0, description: error.message });
    });
    request.write(body);
    request.end();
  });
}

/** Paragraf sınırlarını korumaya çalışarak Unicode-güvenli parçalama. */
export function splitForTelegram(text: string, limit = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.3) {
      cut = limit;
      // Unicode yedek çiftini bölmemek için geri çekil
      const code = remaining.codePointAt(cut);
      if (code !== undefined && code > 0xffff) cut -= 1;
    } else {
      cut += remaining[cut] === "\n" ? 1 : 0;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining.trim()) chunks.push(remaining);
  return chunks;
}

/** Ayarlar ekranındaki açık "Test mesajı gönder" için. */
export function buildTestMessage(): string {
  return "✅ Readflow ↔ Telegram bağlantı testi başarılı.";
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
    return this.sendChunks(payloadContent(payload), payload.document);
  }

  async sendTest(): Promise<RemoteExportResult> {
    return this.sendChunks(buildTestMessage(), null);
  }

  private async sendChunks(content: string, document: ExportPayload["document"] | null): Promise<RemoteExportResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        message: `Telegram entegrasyonu kurulmadı. Coolify/.env içine şunları ekleyin: ${this.missingConfig().join(", ")}`,
      };
    }
    // Bot token biçimi: <sayılar>:<harf/rakam/_/->. Path'e girmeden temizlenir.
    const rawToken = process.env.READFLOW_TELEGRAM_BOT_TOKEN!.trim();
    const safeToken = rawToken.replace(/[^0-9A-Za-z:_-]/g, "");
    if (safeToken !== rawToken) {
      return { ok: false, message: "READFLOW_TELEGRAM_BOT_TOKEN beklenmeyen karakterler içeriyor" };
    }
    const chatId = process.env.READFLOW_TELEGRAM_CHAT_ID!.trim();
    const header = document
      ? `📄 ${document.title}${document.source_url ? `\n${document.source_url}` : ""}\n\n`
      : "";
    const full = header + content.trim();

    // Bot API mesaj başına 4096 karakter sınırı koyar; paragraf sınırları korunur.
    const chunks = splitForTelegram(full);
    let sent = 0;
    for (const chunk of chunks) {
      const outcome = await sendMessage(safeToken, chatId, chunk);
      if (!outcome.ok) {
        // Kısmi gönderim: gönderilenleri raporla, kalanı körlemesine yeniden gönderme.
        const suffix =
          outcome.retryAfter !== undefined
            ? ` Hız sınırı: ${outcome.retryAfter} sn sonra yeniden dene.`
            : outcome.description
              ? ` (${outcome.description})`
              : "";
        const partial = sent > 0 ? ` İlk ${sent}/${chunks.length} parça gönderilmişti; kalan gönderilmedi.` : "";
        return {
          ok: false,
          message: `Telegram hatası (HTTP ${outcome.status}).${suffix}${partial}`,
        };
      }
      sent += 1;
    }
    return { ok: true, message: `Telegram'a gönderildi (${chunks.length} mesaj).` };
  }
}
