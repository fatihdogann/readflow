import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { cancelJob } from "@/lib/db/repo/jobs";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const cancelMessages: Record<string, string> = {
  cancelled: "İş iptal edildi.",
  "abort-requested": "İptal talebi alındı — çalışan süreç sonlandırılıyor.",
  "already-finished": "İş çoktan sonuçlanmış; iptal yapılamadı.",
};

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const jobId = Number(id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new InputError("Geçersiz job kimliği");
    }
    const outcome = cancelJob(getDb(), jobId);
    return Response.json({
      job: outcome.job,
      action: outcome.action,
      message: cancelMessages[outcome.action],
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
