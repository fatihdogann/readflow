import { apiErrorResponse } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { listAllAnnotations, type AnnotationColor } from "@/lib/db/repo/annotations";

export const dynamic = "force-dynamic";

const COLORS: AnnotationColor[] = ["yellow", "green", "lavender"];
const PAGE_SIZE = 60;

/** Tüm belgelerdeki vurgular (arşiv görünümü). */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const get = (key: string): string | undefined => url.searchParams.get(key)?.trim() || undefined;
    const offset = Math.max(Number(get("offset") ?? 0) || 0, 0);

    const rows = listAllAnnotations(getDb(), {
      color: COLORS.find((color) => color === get("renk")),
      q: get("q"),
      withNote: get("notlu") === "1",
      limit: PAGE_SIZE + 1,
      offset,
    });

    return Response.json({
      annotations: rows.slice(0, PAGE_SIZE),
      hasMore: rows.length > PAGE_SIZE,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
