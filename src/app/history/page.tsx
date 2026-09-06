import { getDb } from "@/lib/db/connection";
import { listDomains } from "@/lib/db/repo/documents";
import { listFolders } from "@/lib/db/repo/folders";
import { listDistinctAgentNames } from "@/lib/db/repo/outputs";
import { listTags } from "@/lib/db/repo/tags";
import { parseHistoryFilters } from "@/lib/history/filters";
import { HistoryView } from "@/components/HistoryView";

export const dynamic = "force-dynamic";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const db = getDb();
  return (
    <HistoryView
      title="Geçmiş"
      basePath="/history"
      initialFilters={parseHistoryFilters(params)}
      facets={{
        domains: listDomains(db),
        folders: listFolders(db).map((folder) => ({
          id: folder.id,
          name: folder.name,
          document_count: folder.document_count,
        })),
        tags: listTags(db).map((tag) => ({ id: tag.id, name: tag.name })),
        agents: listDistinctAgentNames(db),
      }}
    />
  );
}
