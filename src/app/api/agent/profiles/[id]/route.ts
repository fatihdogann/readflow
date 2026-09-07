import { z } from "zod";
import { assertMutationAllowed } from "@/lib/api/local";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { deleteProfile, getProfile, updateProfile } from "@/lib/db/repo/agentProfiles";
import { buildArgvForProfile, resolveTransport, effectiveCapabilities, EFFORT_LEVELS } from "@/lib/agent/profiles";
import { getMeta } from "@/lib/db/repo/meta";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  model: z.string().max(120).nullable().optional(),
  provider: z.string().max(120).nullable().optional(),
  effort: z.enum(EFFORT_LEVELS).nullable().optional(),
  priority: z.number().int().min(1).max(999).optional(),
  transport: z.enum(["stdin", "argv"]).optional(),
  timeoutMs: z.number().int().min(5000).max(600_000).optional(),
  enabled: z.boolean().optional(),
});

async function idFrom(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new InputError("Geçersiz profil kimliği");
  return parsed;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    await assertMutationAllowed(request);
    const id = await idFrom(context);
    const body = patchSchema.parse(await readJsonBody(request));
    const profile = getProfile(getDb(), id);
    if (!profile) return Response.json({ error: "Profil bulunamadı" }, { status: 404 });
    // Coolify'da CLI kurulu değil: yetenekler Mac worker raporundan okunur.
    const caps = effectiveCapabilities(getMeta(getDb(), "worker_capabilities"), profile.cli);
    const model = body.model !== undefined ? body.model?.trim() || null : profile.model;
    if (model && caps.modelOptions && !caps.modelOptions.includes(model)) {
      throw new InputError(`Model "${model}" ${profile.cli} kataloğunda yok — listeden seçin`);
    }
    // Güncel yetenekler ile komut doğrulaması (yalnızca doğrulanmış bayraklar).
    buildArgvForProfile(
      {
        cli: profile.cli,
        model,
        provider: body.provider ?? profile.provider,
        effort: body.effort !== undefined ? body.effort : profile.effort,
      },
      caps,
    );
    const updated = updateProfile(getDb(), id, {
      ...body,
      transport: resolveTransport(caps, body.transport ?? profile.transport),
      capabilitiesJson: JSON.stringify(caps),
    });
    return Response.json({ profile: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    await assertMutationAllowed(request);
    const id = await idFrom(context);
    const removed = deleteProfile(getDb(), id);
    return Response.json({ ok: removed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
