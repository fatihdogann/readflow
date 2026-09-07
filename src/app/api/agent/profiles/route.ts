import { z } from "zod";
import { assertMutationAllowed } from "@/lib/api/local";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createProfile, getDefaultProfileId, listProfiles } from "@/lib/db/repo/agentProfiles";
import { discoverAllCapabilities, type SupportedCli } from "@/lib/agent/capabilities";
import {
  getEnvironmentLock,
  buildArgvForProfile,
  resolveTransport,
  effectiveCapabilities,
  EFFORT_LEVELS,
} from "@/lib/agent/profiles";
import { getMeta } from "@/lib/db/repo/meta";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  cli: z.enum(["claude", "codex", "jcode"]),
  model: z.string().max(120).nullable().optional(),
  provider: z.string().max(120).nullable().optional(),
  effort: z.enum(EFFORT_LEVELS).nullable().optional(),
  priority: z.number().int().min(1).max(999).optional(),
  transport: z.enum(["stdin", "argv"]).optional(),
  timeoutMs: z.number().int().min(5000).max(600_000).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    // Yetenekler öncelikle Mac worker'ın raporladığından okunur (Coolify'da
    // container'da CLI olmadığı için sunucu tespiti boş/yanıltıcı olabilir);
    // worker raporu yoksa sunucu tarafı tespit denenir.
    const workerCapsRaw = getMeta(db, "worker_capabilities");
    let candidates: ReturnType<typeof discoverAllCapabilities> = [];
    if (workerCapsRaw) {
      try {
        candidates = JSON.parse(workerCapsRaw) as ReturnType<typeof discoverAllCapabilities>;
      } catch {
        candidates = [];
      }
    }
    if (candidates.length === 0) {
      candidates = discoverAllCapabilities();
    }
    let validatePending = false;
    const pendingRaw = getMeta(db, "profile_validate_request");
    if (pendingRaw) {
      try {
        validatePending = Boolean((JSON.parse(pendingRaw) as { profileId?: number }).profileId);
      } catch {
        validatePending = false;
      }
    }
    return Response.json({
      envLock: getEnvironmentLock(),
      candidates,
      profiles: listProfiles(db),
      defaultProfileId: getDefaultProfileId(db),
      validatePending,
      source: workerCapsRaw ? "worker" : "server",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await assertMutationAllowed(request);
    const body = createSchema.parse(await readJsonBody(request));
    // Yetenek kaynağı: önce Mac worker'ın raporladığı veriler (Coolify'da
    // container'da CLI olmadığından sunucu tespiti bulunamayabilir); worker
    // çalışma sırasında bayrakları kendi tarafında yeniden doğrular.
    const caps = effectiveCapabilities(getMeta(getDb(), "worker_capabilities"), body.cli);
    const model = body.model?.trim() || null;
    if (model && caps.modelOptions && !caps.modelOptions.includes(model)) {
      const suggestions = caps.modelOptions
        .filter((option) => option.includes(model.split(/[\s.]/)[0]?.toLowerCase() ?? ""))
        .slice(0, 5);
      throw new InputError(
        `Model "${model}" ${body.cli} kataloğunda yok. Ayarlar ekranındaki listeden seçin.${suggestions.length > 0 ? ` Yakın seçenekler: ${suggestions.join(", ")}` : ""}`,
      );
    }
    // Komut üretimi yalnızca doğrulanmış preset + bayraklarla olur; serbest metin kabul edilmez.
    buildArgvForProfile(
      { cli: body.cli, model, provider: body.provider ?? null, effort: body.effort ?? null },
      caps,
    );
    const capabilitiesJson = JSON.stringify(caps);
      const profile = createProfile(
        getDb(),
        {
          name: body.name,
          cli: body.cli as SupportedCli,
          model,
          provider: body.provider ?? null,
          effort: body.effort ?? null,
          priority: body.priority,
          transport: resolveTransport(caps, body.transport),
          timeoutMs: body.timeoutMs,
        },
        capabilitiesJson,
      );
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
