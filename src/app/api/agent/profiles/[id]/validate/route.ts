import { assertMutationAllowed } from "@/lib/api/local";
import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { getMeta, setMeta } from "@/lib/db/repo/meta";
import { getProfile } from "@/lib/db/repo/agentProfiles";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const VALIDATE_REQUEST_KEY = "profile_validate_request";

/**
 * Profil doğrulaması Mac worker'a devredilir: istek meta tablosuna yazılır,
 * worker heartbeat/claim yanıtında alıp kendi CLI'ıyla test eder ve sonucu
 * profile geri yazar. Container'da CLI olmadığından bu tek doğru yoldur.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    await assertMutationAllowed(request);
    const { id } = await context.params;
    const profileId = Number(id);
    if (!Number.isInteger(profileId) || profileId <= 0) throw new InputError("Geçersiz profil");
    const profile = getProfile(getDb(), profileId);
    if (!profile) return Response.json({ error: "Profil bulunamadı" }, { status: 404 });

    const db = getDb();
    const pendingRaw = getMeta(db, VALIDATE_REQUEST_KEY);
    if (pendingRaw) {
      return Response.json({
        ok: true,
        pending: true,
        message: "Önceki doğrulama isteği hâlâ işleniyor — sonuç birkaç saniye içinde görünür.",
      });
    }
    setMeta(db, VALIDATE_REQUEST_KEY, JSON.stringify({ profileId, requestedAt: new Date().toISOString() }));
    return Response.json({
      ok: true,
      pending: true,
      message: "Doğrulama isteği Mac worker'a iletildi; sonuç birkaç saniye içinde profilde görünür.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
