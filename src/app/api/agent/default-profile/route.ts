import { z } from "zod";
import { assertLocalRequest } from "@/lib/api/local";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import {
  getDefaultProfileId,
  getProfile,
  setDefaultProfileId,
} from "@/lib/db/repo/agentProfiles";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  profileId: z.number().int().positive().nullable(),
});

export async function GET(): Promise<Response> {
  try {
    return Response.json({ defaultProfileId: getDefaultProfileId(getDb()) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    const body = putSchema.parse(await readJsonBody(request));
    if (body.profileId !== null) {
      const profile = getProfile(getDb(), body.profileId);
      if (!profile) throw new InputError("Profil bulunamadı");
      if (!profile.enabled) throw new InputError("Devre dışı profil varsayılan yapılamaz");
    }
    setDefaultProfileId(getDb(), body.profileId);
    return Response.json({ defaultProfileId: body.profileId });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
