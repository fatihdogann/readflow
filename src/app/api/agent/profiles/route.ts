import { z } from "zod";
import { assertLocalRequest } from "@/lib/api/local";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import {
  createProfile,
  getDefaultProfileId,
  listProfiles,
  type SupportedCli,
} from "@/lib/db/repo/agentProfiles";
import { discoverAllCapabilities, getCachedCapabilities } from "@/lib/agent/capabilities";
import { getEnvironmentLock } from "@/lib/agent/profiles";
import { buildArgvForProfile, resolveTransport } from "@/lib/agent/profiles";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

const SUPPORTED: SupportedCli[] = ["claude", "codex", "jcode"];

const createSchema = z.object({
  name: z.string().min(1).max(80),
  cli: z.enum(["claude", "codex", "jcode"]),
  model: z.string().max(120).nullable().optional(),
  provider: z.string().max(120).nullable().optional(),
  transport: z.enum(["stdin", "argv"]).optional(),
  timeoutMs: z.number().int().min(5000).max(600_000).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    return Response.json({
      envLock: getEnvironmentLock(),
      candidates: discoverAllCapabilities(),
      profiles: listProfiles(db),
      defaultProfileId: getDefaultProfileId(db),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    const body = createSchema.parse(await readJsonBody(request));
    const caps = getCachedCapabilities(body.cli);
    if (!caps.found) {
      throw new InputError(`${body.cli} kurulu değil — profil oluşturulamaz`);
    }
    if (!caps.nonInteractive) {
      throw new InputError(`${body.cli} için non-interactive kullanım doğrulanamadı`);
    }
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
    buildArgvForProfile({ cli: body.cli, model, provider: body.provider ?? null }, caps);
    const capabilitiesJson = JSON.stringify(caps);
    const profile = createProfile(
      getDb(),
      {
        name: body.name,
        cli: body.cli,
        model,
        provider: body.provider ?? null,
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

export const SUPPORTED_CLIS = SUPPORTED;
