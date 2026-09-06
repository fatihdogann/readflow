export interface HistoryViewFilters {
  q?: string;
  domain?: string;
  folderId?: number | "none";
  tag?: string;
  agent?: string;
  favorite?: boolean;
  notlu?: boolean;
  duzenlenmis?: boolean;
  offset?: number;
}

/** URL searchParams → filtre nesnesi (sunucu sayfası ve istemci ortak kullanır). */
export function parseHistoryFilters(
  params: Record<string, string | string[] | undefined>,
): HistoryViewFilters {
  const get = (key: string): string | undefined => {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    return single?.trim() || undefined;
  };
  const folderRaw = get("folder");
  let folderId: HistoryViewFilters["folderId"];
  if (folderRaw === "none") folderId = "none";
  else if (folderRaw && Number.isInteger(Number(folderRaw))) folderId = Number(folderRaw);
  return {
    q: get("q"),
    domain: get("domain"),
    tag: get("tag"),
    agent: get("agent"),
    folderId,
    notlu: get("notlu") === "1",
    duzenlenmis: get("duzenlenmis") === "1",
    favorite: get("favorite") === "1",
  };
}
