import fs from "node:fs";
import path from "node:path";
import { assertMutationAllowed } from "@/lib/api/local";
import { apiErrorResponse } from "@/lib/api/http";
import { getOrCreateIngestToken } from "../ingest/route";

export const dynamic = "force-dynamic";

/**
 * Ayarlar ekranı için hazır bookmarklet: kaynak dosya sıkıştırılıp
 * `javascript:` bağlantısına çevrilir.
 *
 * Bilinçli olarak /api/ingest altında DEĞİL: orası bookmarklet'in kendi
 * token'ıyla eriştiği, oturum sınırının dışındaki uç. Token'ı döndüren bu uç
 * ise oturum ister.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await assertMutationAllowed(request);
    const token = getOrCreateIngestToken();
    const origin = new URL(request.url).origin;

    const source = fs.readFileSync(path.join(process.cwd(), "public", "bookmarklet.js"), "utf8");
    const minified = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace("__READFLOW_ORIGIN__", origin)
      // Token bookmarklet'in içine gömülür: cross-site POST'ta cookie gitmez.
      .replace('"content-type": "application/json"', `"content-type":"application/json","authorization":"Bearer ${token}"`)
      .replace("/api/documents", "/api/ingest");

    return Response.json({
      href: `javascript:${encodeURIComponent(minified)}`,
      origin,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
