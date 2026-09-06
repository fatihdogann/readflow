import { z } from "zod";
import { assertLocalRequest } from "@/lib/api/local";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { deleteProfile, getProfile, updateProfile } from "@/lib/db/repo/agentProfiles";
import { getCachedCapabilities } from "@/lib/agent/capabilities";
import { buildArgvForProfile, resolveTransport } from "@/lib/agent/profiles";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  model: z.string().max(120).nullable().optional(),
  provider: z.string().max(120).nullable().optional(),
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
    assertLocalRequest(request);
    const id = await idFrom(context);
    const body = patchSchema.parse(await readJsonBody(request));
    const profile = getProfile(getDb(), id);
    if (!profile) return Response.json({ error: "Profil bulunamadı" }, { status: 404 });
    const caps = getCachedCapabilities(profile.cli);
    const model = body.model !== undefined ? body.model?.trim() || null : profile.model;
    if (model && caps.modelOptions && !caps.modelOptions.includes(model)) {
      throw new InputError(`Model "${model}" ${profile.cli} kataloğunda yok — listeden seçin`);
    }
    // Güncel yetenekler ile komut doğrulaması (yalnızca doğrulanmış bayraklar).
    buildArgvForProfile(
      { cli: profile.cli, model, provider: body.provider ?? profile.provider },
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
    assertLocalRequest(request);
    const id = await idFrom(context);
    const removed = deleteProfile(getDb(), id);
    return Response.json({ ok: removed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
