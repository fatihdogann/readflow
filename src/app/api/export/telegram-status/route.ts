import { getMeta, setMeta } from "@/lib/db/repo/meta";
import { apiErrorResponse } from "@/lib/api/http";
import { assertMutationAllowed } from "@/lib/api/local";
import { getDb } from "@/lib/db/connection";
import { TelegramExporter } from "@/lib/export/telegram";

export const dynamic = "force-dynamic";

/**
 * Telegram kurulum durumu: env var → "yapılandırıldı"; son test başarılı →
 * "doğrulandı". Ortam değişkeni mevcut diye çalışıyor sayılmaz.
 */
export async function GET(): Promise<Response> {
  try {
    const exporter = new TelegramExporter();
    const configured = exporter.isConfigured();
    const db = getDb();
    const lastTestAt = getMeta(db, "telegram_last_test_at");
    const lastTestOk = getMeta(db, "telegram_last_test_ok") === "1";
    const lastTestMessage = getMeta(db, "telegram_last_test_message");
    const status = !configured ? "kurulmadı" : lastTestOk ? "doğrulandı" : lastTestAt ? "hata" : "yapılandırıldı";
    return Response.json({
      status,
      configured,
      lastTestAt,
      lastTestOk,
      lastTestMessage,
      missing: configured ? [] : exporter.missingConfig(),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Yalnızca açıkça tetiklenen bağlantı testi: tek kısa mesaj gönderir. */
export async function POST(request: Request): Promise<Response> {
  try {
    await assertMutationAllowed(request);
    const exporter = new TelegramExporter();
    const result = await exporter.sendTest();
    const db = getDb();
    setMeta(db, "telegram_last_test_at", new Date().toISOString());
    setMeta(db, "telegram_last_test_ok", result.ok ? "1" : "0");
    setMeta(db, "telegram_last_test_message", result.message.slice(0, 400));
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
