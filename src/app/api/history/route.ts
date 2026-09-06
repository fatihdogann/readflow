import { getDb } from "@/lib/db/connection";
import {
  listDocuments,
  searchDocuments,
  type DocumentFilters,
} from "@/lib/db/repo/documents";
import { listOutputSummariesForDocuments } from "@/lib/db/repo/outputs";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Canlı filtreleme için arşiv sorgusu. Filtreler URL query'sinden gelir;
 * liste hafif projeksiyondur (tam metin/HTML taşımaz).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const get = (key: string): string | undefined => url.searchParams.get(key)?.trim() || undefined;

    const folderRaw = get("folder");
    let folderId: DocumentFilters["folderId"];
    if (folderRaw === "none") folderId = "none";
    else if (folderRaw && Number.isInteger(Number(folderRaw))) folderId = Number(folderRaw);

    const offset = Math.max(Number(get("offset") ?? 0) || 0, 0);
    const filters: DocumentFilters = {
      q: get("q"),
      domain: get("domain"),
      tag: get("tag"),
      agent: get("agent"),
      folderId,
      favorite: get("favorite") === "1",
      notlu: get("notlu") === "1",
      duzenlenmis: get("duzenlenmis") === "1",
    };

    const db = getDb();
    const docs = filters.q
      ? searchDocuments(db, { ...filters, limit: PAGE_SIZE + 1, offset })
      : listDocuments(db, { ...filters, limit: PAGE_SIZE + 1, offset });
    const hasMore = docs.length > PAGE_SIZE;
    const visible = docs.slice(0, PAGE_SIZE);
    const outputs = listOutputSummariesForDocuments(
      db,
      visible.map((doc) => doc.id),
    );

    return Response.json({
      docs: visible,
      hasMore,
      outputs: Array.from(outputs.entries()),
    });
  } catch (error) {
    console.error("[api/history]", error);
    return Response.json({ error: "Arşiv sorgusu başarısız" }, { status: 500 });
  }
}
