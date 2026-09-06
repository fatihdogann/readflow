import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { retryJob } from "@/lib/db/repo/jobs";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const jobId = Number(id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new InputError("Geçersiz job kimliği");
    }
    const job = retryJob(getDb(), jobId);
    return Response.json({ job });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
