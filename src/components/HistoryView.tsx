import { getDb } from "@/lib/db/connection";
import { listDomains, listDocuments } from "@/lib/db/repo/documents";
import { listFolders } from "@/lib/db/repo/folders";
import { listOutputSummariesForDocuments } from "@/lib/db/repo/outputs";
import { listTags } from "@/lib/db/repo/tags";
import { DocumentList, type OutputBadge } from "@/components/DocumentList";

export interface HistoryFilters {
  q?: string;
  domain?: string;
  folderId?: number | "none";
  tag?: string;
  favorite?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Geçmiş/favoriler için ortak liste + filtre çubuğu.
 * Filtreler GET formu ile taşınır (JS'siz de çalışır).
 */
export function HistoryView({
  filters,
  title,
}: {
  filters: HistoryFilters;
  title: string;
}) {
  const db = getDb();
  const docs = listDocuments(db, { ...filters, limit: 100 });
  const outputsByDoc = listOutputSummariesForDocuments(
    db,
    docs.map((doc) => doc.id),
  ) as Map<number, OutputBadge[]>;
  const domains = listDomains(db);
  const folders = listFolders(db);
  const tags = listTags(db);

  const selectClass =
    "rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs outline-none dark:border-stone-700 dark:bg-stone-900";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="no-print flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <form method="get" action={filters.favorite ? "/favorites" : "/history"} className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Ara…"
            className="min-w-40 flex-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900"
          />
          <select name="domain" defaultValue={filters.domain ?? ""} className={selectClass}>
            <option value="">Tüm domainler</option>
            {domains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
          <select name="folder" defaultValue={typeof filters.folderId === "number" ? String(filters.folderId) : filters.folderId === "none" ? "none" : ""} className={selectClass}>
            <option value="">Tüm klasörler</option>
            <option value="none">Klasörsüz</option>
            {folders.map((folder) => (
              <option key={folder.id} value={String(folder.id)}>
                {folder.name}
              </option>
            ))}
          </select>
          <select name="tag" defaultValue={filters.tag ?? ""} className={selectClass}>
            <option value="">Tüm etiketler</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Filtrele
          </button>
        </form>
        <div className="px-1 text-xs text-stone-400">
          {docs.length} doküman{docs.length === 1 ? "" : ""}
        </div>
      </div>

      <DocumentList docs={docs} outputsByDoc={outputsByDoc} />
    </div>
  );
}

export function parseHistoryFilters(
  params: Record<string, string | string[] | undefined>,
): HistoryFilters {
  const get = (key: string): string | undefined => {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    const trimmed = single?.trim();
    return trimmed ? trimmed : undefined;
  };
  const folderRaw = get("folder");
  let folderId: HistoryFilters["folderId"];
  if (folderRaw === "none") folderId = "none";
  else if (folderRaw && Number.isInteger(Number(folderRaw))) folderId = Number(folderRaw);
  return {
    q: get("q"),
    domain: get("domain"),
    tag: get("tag"),
    folderId,
  };
}
