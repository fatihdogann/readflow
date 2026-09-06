import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { listOutputRevisions } from "@/lib/db/repo/outputs";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Bir AI çıktısının değişmez revizyon geçmişi (en yeni önce, içerikle). */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const outputId = Number(id);
    if (!Number.isInteger(outputId) || outputId <= 0) {
      return Response.json({ error: "Geçersiz çıktı kimliği" }, { status: 400 });
    }
    const revisions = listOutputRevisions(getDb(), outputId).map((revision) => ({
      id: revision.id,
      agent_name: revision.agent_name,
      job_id: revision.job_id,
      created_at: revision.created_at,
      content: revision.content,
    }));
    return Response.json({ revisions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
