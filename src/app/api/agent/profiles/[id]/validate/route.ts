import { assertLocalRequest } from "@/lib/api/local";
import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { getProfile, setValidationResult } from "@/lib/db/repo/agentProfiles";
import { createProfileAdapter } from "@/lib/agent/profiles";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const TEST_PROMPT = "Bu bir bağlantı testidir. Yalnızca şu kelimeyi yaz: TAMAM";

/**
 * Profilin gerçekten çalışıp çalışmadığını örnek metinle test eder.
 * Kullanıcı belgesi gönderilmez; CLI'ın kendi oturumu/kimliği kullanılır.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertLocalRequest(request);
    const { id } = await context.params;
    const profileId = Number(id);
    if (!Number.isInteger(profileId) || profileId <= 0) throw new InputError("Geçersiz profil");
    const profile = getProfile(getDb(), profileId);
    if (!profile) return Response.json({ error: "Profil bulunamadı" }, { status: 404 });

    const adapter = createProfileAdapter(profile);
    const startedAt = Date.now();
    try {
      const result = await adapter.run({
        prompt: TEST_PROMPT,
        timeoutMs: Math.min(profile.timeout_ms, 90_000),
      });
      const durationMs = Date.now() - startedAt;
      const ok = /TAMAM/.test(result.text);
      setValidationResult(getDb(), profileId, ok, ok ? null : `Beklenen yanıt alınamadı: ${result.text.slice(0, 120)}`);
      return Response.json({
        ok,
        durationMs,
        message: ok
          ? `Doğrulandı (${(durationMs / 1000).toFixed(1)} sn içinde TAMAM yanıtı)`
          : "CLI yanıt verdi ancak beklenen test yanıtı alınamadı",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationResult(getDb(), profileId, false, message.slice(0, 400));
      return Response.json({ ok: false, message, durationMs: Date.now() - startedAt });
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
