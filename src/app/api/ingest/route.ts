import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { getMeta, setMeta } from "@/lib/db/repo/meta";
import { createDocumentFromInput } from "@/lib/documents/service";
import { looksLikeUrl } from "@/lib/types";

export const dynamic = "force-dynamic";

const TOKEN_KEY = "ingest_token";
const MAX_HTML_CHARS = 5_000_000;

/**
 * Bookmarklet ve telefon paylaşım menüsü (iOS Kestirmeler) giriş noktası.
 *
 * Tarayıcı sekmesindeki HTML'i alır; sunucu sayfayı indirmez. Bot koruması,
 * paywall ve JS ile üretilen sayfalar kullanıcının kendi oturumundan geçer.
 *
 * Yetki oturum cookie'siyle olamaz: bookmarklet başka bir sitenin origin'inden
 * çalışır ve `SameSite=Lax` cookie cross-site POST'a eklenmez. Bu yüzden
 * `/api/worker` ile aynı desende ayrı bir taşıyıcı token kullanılır.
 */
export function getOrCreateIngestToken(): string {
  const db = getDb();
  const existing = getMeta(db, TOKEN_KEY);
  if (existing && existing.length >= 32) return existing;
  const token = randomBytes(24).toString("base64url");
  setMeta(db, TOKEN_KEY, token);
  return token;
}

/** Token'ı iptal edip yenisini üretir: eski bookmarklet ve Kestirme çalışmaz olur. */
export function rotateIngestToken(): string {
  const token = randomBytes(24).toString("base64url");
  setMeta(getDb(), TOKEN_KEY, token);
  return token;
}

function authorized(request: Request): boolean {
  const expected = getMeta(getDb(), TOKEN_KEY);
  if (!expected) return false; // token üretilmemişse uç kapalı
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

/** Token ile yetkilendirildiği için origin serbest; cookie hiç kullanılmaz. */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// html: bookmarklet (sunucu siteye gitmez). url/text: iOS Kestirmeler / paylaşım menüsü.
const schema = z
  .object({
    html: z.string().max(MAX_HTML_CHARS).optional(),
    url: z.string().max(2000).optional(),
    text: z.string().max(MAX_HTML_CHARS).optional(),
    sourceUrl: z.string().max(2000).optional(),
    title: z.string().max(300).optional(),
  })
  .refine((body) => Boolean(body.html?.trim() || body.url?.trim() || body.text?.trim()), {
    message: "html, url veya text gerekli",
  });

export async function POST(request: Request): Promise<Response> {
  try {
    if (!authorized(request)) {
      return Response.json({ error: "Yetkisiz" }, { status: 401, headers: CORS_HEADERS });
    }
    const body = schema.parse(await request.json());
    // Paylaşım menüsü bağlantıyı düz metin olarak da verebilir.
    const text = body.text?.trim();
    const input = text && !body.url && !body.html && looksLikeUrl(text) ? { ...body, url: text, text: undefined } : body;
    const document = await createDocumentFromInput(getDb(), input);
    return Response.json(
      { id: document.id, title: document.title },
      { status: 201, headers: CORS_HEADERS },
    );
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
