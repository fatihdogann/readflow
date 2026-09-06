import Link from "next/link";
import { getDb } from "@/lib/db/connection";
import { listDistinctAgentNames } from "@/lib/db/repo/outputs";
import {
  listDocuments,
  searchDocuments,
  type DocumentFilters,
  type DocumentListItem,
} from "@/lib/db/repo/documents";
import { listDomains } from "@/lib/db/repo/documents";
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
  notlu?: boolean;
  duzenlenmis?: boolean;
  agent?: string;
  offset?: number;
}

const PAGE_SIZE = 50;

/**
 * Geçmiş/favoriler için ortak liste + filtre çubuğu.
 * Filtreler GET formu ile taşınır; load-more offset'i URL'de korunur.
 */
export function HistoryView({
  filters,
  title,
}: {
  filters: HistoryFilters;
  title: string;
}) {
  const db = getDb();
  const base = filters.favorite ? "/favorites" : "/history";
  const docs: DocumentListItem[] = filters.q
    ? searchDocuments(db, { ...filters, limit: PAGE_SIZE + 1 })
    : listDocuments(db, { ...filters, limit: PAGE_SIZE + 1 });
  const hasMore = docs.length > PAGE_SIZE;
  const visible = docs.slice(0, PAGE_SIZE);
  const outputsByDoc = listOutputSummariesForDocuments(
    db,
    visible.map((doc) => doc.id),
  ) as Map<number, OutputBadge[]>;
  const domains = listDomains(db);
  const folders = listFolders(db);
  const tags = listTags(db);
  const agents = listDistinctAgentNames(db);

  const selectClass =
    "min-h-[36px] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs outline-none dark:border-stone-700 dark:bg-stone-900";
  const nextOffset = (filters.offset ?? 0) + PAGE_SIZE;

  const moreParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || key === "offset") continue;
    moreParams.set(key, String(value));
  }
  moreParams.set("offset", String(nextOffset));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="no-print flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-[-0.025em]">{title}</h1>
        <form method="get" action={base} className="mt-3 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white/65 p-3 shadow-[0_10px_30px_rgba(28,25,23,0.04)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none">
          <div className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Belge, düzenlenmiş metin, not ve AI çıktılarında ara…"
              aria-label="Arama"
              className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-stone-500 focus:border-stone-500 focus:ring-2 focus:ring-stone-900/5 dark:border-stone-700 dark:bg-stone-950/40 dark:placeholder:text-stone-400 dark:focus:ring-white/5"
            />
            <button
              type="submit"
              className="min-h-[40px] rounded-xl bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              Ara
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          <select name="domain" defaultValue={filters.domain ?? ""} aria-label="Domain filtresi" className={selectClass}>
            <option value="">Tüm domainler</option>
            {domains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
          <select name="folder" defaultValue={typeof filters.folderId === "number" ? String(filters.folderId) : filters.folderId === "none" ? "none" : ""} aria-label="Klasör filtresi" className={selectClass}>
            <option value="">Tüm klasörler</option>
            <option value="none">Klasörsüz</option>
            {folders.map((folder) => (
              <option key={folder.id} value={String(folder.id)}>
                {folder.name}
              </option>
            ))}
          </select>
          <select name="tag" defaultValue={filters.tag ?? ""} aria-label="Etiket filtresi" className={selectClass}>
            <option value="">Tüm etiketler</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </select>
          <select name="agent" defaultValue={filters.agent ?? ""} aria-label="AI filtresi" className={selectClass}>
            <option value="">Tüm AI&apos;lar</option>
            {agents.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
          <label className="flex min-h-[36px] items-center gap-1 text-xs text-stone-600 dark:text-stone-400">
            <input type="checkbox" name="notlu" value="1" defaultChecked={filters.notlu} className="accent-stone-700" />
            Notlu
          </label>
          <label className="flex min-h-[36px] items-center gap-1 text-xs text-stone-600 dark:text-stone-400">
            <input type="checkbox" name="duzenlenmis" value="1" defaultChecked={filters.duzenlenmis} className="accent-stone-700" />
            Düzenlenmiş
          </label>
          <label className="flex min-h-[36px] items-center gap-1 text-xs text-stone-600 dark:text-stone-400">
            <input type="checkbox" name="favorite" value="1" defaultChecked={filters.favorite} className="accent-stone-700" />
            Favori
          </label>
          <button type="submit" className="min-h-[36px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800">Filtreleri uygula</button>
          <Link href={base} className="min-h-[36px] px-2 text-xs leading-[36px] text-stone-500 underline underline-offset-2 dark:text-stone-400">
            Sıfırla
          </Link>
          </div>
        </form>
        <div className="mt-3 px-1 text-xs text-stone-500 dark:text-stone-400">{visible.length} doküman</div>
      </div>

      <DocumentList docs={visible} outputsByDoc={outputsByDoc} />

      {hasMore ? (
        <Link
          href={`${base}?${moreParams.toString()}`}
          className="no-print mx-auto min-h-[40px] rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          Daha fazla yükle
        </Link>
      ) : null}
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
  const offsetRaw = Number(get("offset"));
  return {
    q: get("q"),
    domain: get("domain"),
    tag: get("tag"),
    agent: get("agent"),
    folderId,
    notlu: get("notlu") === "1",
    duzenlenmis: get("duzenlenmis") === "1",
    offset: Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0,
  };
}

export type { DocumentFilters };
