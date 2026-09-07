"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentListItem } from "@/lib/db/repo/documents";
import { DocumentList, type OutputBadge } from "@/components/DocumentList";
import { parseHistoryFilters, type HistoryViewFilters } from "@/lib/history/filters";

export type { HistoryViewFilters };
export { parseHistoryFilters };

export interface HistoryFacets {
  domains: string[];
  folders: Array<{ id: number; name: string; document_count: number }>;
  tags: Array<{ id: number; name: string }>;
  agents: string[];
}

interface FetchResult {
  docs: DocumentListItem[];
  hasMore: boolean;
  outputs: Array<[number, OutputBadge[]]>;
}

function buildQuery(filters: HistoryViewFilters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.agent) params.set("agent", filters.agent);
  if (filters.folderId === "none") params.set("folder", "none");
  else if (typeof filters.folderId === "number") params.set("folder", String(filters.folderId));
  if (filters.favorite) params.set("favorite", "1");
  if (filters.readState) params.set("durum", filters.readState);
  if (filters.notlu) params.set("notlu", "1");
  if (filters.duzenlenmis) params.set("duzenlenmis", "1");
  if (offset > 0) params.set("offset", String(offset));
  return params.toString();
}

/**
 * Anlık arşiv filtreleri: metin araması 300 ms debounce (Enter ile hemen),
 * diğer filtreler anında; URL pushState ile senkron (geri/ileri + yenileme
 * doğru durumu getirir); hızlı değişimlerde eski yanıt yeni sonucu ezmeyecek
 * şekilde sıra numarası + AbortController; filtre değişince sayfalama sıfırlanır.
 */
export function HistoryView({
  initialFilters,
  facets,
  title,
  basePath,
}: {
  initialFilters: HistoryViewFilters;
  facets: HistoryFacets;
  title: string;
  basePath: string;
}) {
  const [filters, setFilters] = useState<HistoryViewFilters>(initialFilters);
  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [outputsByDoc, setOutputsByDoc] = useState<Map<number, OutputBadge[]>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState(initialFilters.q ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Race koruması: sıra numarası + aktif isteği iptal. Ref'lere yalnızca
  // effect içinde tanımlanan doFetch erişir; bileşen API'si runFetch üzerinden.
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fetchRef = useRef<(next: HistoryViewFilters, offset: number) => Promise<void>>(async () => {});
  const skipNextUrlSync = useRef(false);

  useEffect(() => {
    const doFetch = async (next: HistoryViewFilters, offset: number): Promise<void> => {
      const seq = ++seqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const query = buildQuery(next, offset);
        const response = await fetch(`/api/history${query ? `?${query}` : ""}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Sorgu başarısız (HTTP ${response.status})`);
        const body = (await response.json()) as FetchResult;
        if (seq !== seqRef.current) return; // eski yanıt: yok say
        setOutputsByDoc(new Map(body.outputs));
        setHasMore(body.hasMore);
        setDocs((previous) => (offset > 0 ? [...previous, ...body.docs] : body.docs));
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (seq === seqRef.current) {
          setError(fetchError instanceof Error ? fetchError.message : "Sorgu başarısız");
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    };
    fetchRef.current = doFetch;

    const initial = setTimeout(() => void doFetch(initialFilters, initialFilters.offset ?? 0), 0);
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const restored: HistoryViewFilters = {
        q: params.get("q") ?? undefined,
        domain: params.get("domain") ?? undefined,
        tag: params.get("tag") ?? undefined,
        agent: params.get("agent") ?? undefined,
        folderId:
          params.get("folder") === "none"
            ? "none"
            : params.get("folder")
              ? Number(params.get("folder"))
              : undefined,
        favorite: params.get("favorite") === "1",
        readState: (["unread", "reading", "done"] as const).find((state) => state === params.get("durum")),
        notlu: params.get("notlu") === "1",
        duzenlenmis: params.get("duzenlenmis") === "1",
        offset: Number(params.get("offset")) || 0,
      };
      setTextDraft(restored.q ?? "");
      setFilters(restored);
      skipNextUrlSync.current = true;
      void doFetch(restored, restored.offset ?? 0);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("popstate", onPopState);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handler'lar ve debounced efekt bu köprüyı kullanır.
  const runFetch = useCallback((next: HistoryViewFilters, offset: number) => {
    void fetchRef.current(next, offset);
  }, []);

  // Filtre değişimi: URL güncelle + sıfırdan sorgula (offset sıfırlanır)
  const applyFilters = useCallback(
    (next: HistoryViewFilters) => {
      setFilters(next);
      if (skipNextUrlSync.current) {
        skipNextUrlSync.current = false;
      } else {
        const query = buildQuery(next, 0);
        window.history.pushState(null, "", query ? `${basePath}?${query}` : basePath);
      }
      runFetch(next, 0);
    },
    [basePath, runFetch],
  );

  // Metin araması: 300 ms debounce
  useEffect(() => {
    if (textDraft === (filters.q ?? "")) return;
    const timer = setTimeout(() => {
      applyFilters({ ...filters, q: textDraft.trim() || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [textDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchFilters(partial: Partial<HistoryViewFilters>): void {
    applyFilters({ ...filters, ...partial, offset: 0 });
  }

  type ChipKind = "q" | "domain" | "tag" | "agent" | "folder-none" | "folder" | "notlu" | "duzenlenmis" | "favorite" | "durum";
  const activeChips: Array<{ kind: ChipKind; label: string }> = useMemo(() => {
    const chips: Array<{ kind: ChipKind; label: string }> = [];
    if (filters.q) chips.push({ kind: "q", label: `Ara: ${filters.q}` });
    if (filters.domain) chips.push({ kind: "domain", label: `Domain: ${filters.domain}` });
    if (filters.tag) chips.push({ kind: "tag", label: `Etiket: ${filters.tag}` });
    if (filters.agent) chips.push({ kind: "agent", label: `AI: ${filters.agent}` });
    if (filters.folderId === "none") chips.push({ kind: "folder-none", label: "Klasörsüz" });
    else if (typeof filters.folderId === "number") {
      const folder = facets.folders.find((candidate) => candidate.id === filters.folderId);
      if (folder) chips.push({ kind: "folder", label: `Klasör: ${folder.name}` });
    }
    if (filters.notlu) chips.push({ kind: "notlu", label: "Notlu" });
    if (filters.duzenlenmis) chips.push({ kind: "duzenlenmis", label: "Düzenlenmiş" });
    if (filters.favorite) chips.push({ kind: "favorite", label: "Favori" });
    if (filters.readState) {
      const labels = { unread: "Okunacak", reading: "Okuyorum", done: "Bitti" } as const;
      chips.push({ kind: "durum", label: labels[filters.readState] });
    }
    return chips;
  }, [filters, facets.folders]);

  const clearChip = useCallback(
    (kind: ChipKind) => {
      if (kind === "q") {
        setTextDraft("");
        applyFilters({ ...filters, q: undefined });
        return;
      }
      if (kind === "folder") {
        patchFilters({ folderId: undefined });
        return;
      }
      switch (kind) {
        case "domain": patchFilters({ domain: undefined }); break;
        case "tag": patchFilters({ tag: undefined }); break;
        case "agent": patchFilters({ agent: undefined }); break;
        case "folder-none": patchFilters({ folderId: undefined }); break;
        case "notlu": patchFilters({ notlu: false }); break;
        case "duzenlenmis": patchFilters({ duzenlenmis: false }); break;
        case "favorite": patchFilters({ favorite: false }); break;
        case "durum": patchFilters({ readState: undefined }); break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, applyFilters],
  );

  const clearAll = useCallback((): void => {
    setTextDraft("");
    applyFilters({ favorite: filters.favorite });
  }, [filters, applyFilters]);

  const activeCount = activeChips.length;
  const selectClass =
    "min-h-[40px] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500";

  const filterPanel = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Domain filtresi" value={filters.domain ?? ""} onChange={(event) => patchFilters({ domain: event.target.value || undefined })} className={selectClass}>
        <option value="">Tüm domainler</option>
        {facets.domains.map((domain) => (
          <option key={domain} value={domain}>{domain}</option>
        ))}
      </select>
      <select aria-label="Klasör filtresi" value={filters.folderId === "none" ? "none" : String(filters.folderId ?? "")} onChange={(event) => patchFilters({ folderId: event.target.value === "" ? undefined : event.target.value === "none" ? "none" : Number(event.target.value) })} className={selectClass}>
        <option value="">Tüm klasörler</option>
        <option value="none">Klasörsüz</option>
        {facets.folders.map((folder) => (
          <option key={folder.id} value={String(folder.id)}>{folder.name} ({folder.document_count})</option>
        ))}
      </select>
      <select aria-label="Etiket filtresi" value={filters.tag ?? ""} onChange={(event) => patchFilters({ tag: event.target.value || undefined })} className={selectClass}>
        <option value="">Tüm etiketler</option>
        {facets.tags.map((tag) => (
          <option key={tag.id} value={tag.name}>{tag.name}</option>
        ))}
      </select>
      <select aria-label="AI filtresi" value={filters.agent ?? ""} onChange={(event) => patchFilters({ agent: event.target.value || undefined })} className={selectClass}>
        <option value="">Tüm AI&apos;lar</option>
        {facets.agents.map((agent) => (
          <option key={agent} value={agent}>{agent}</option>
        ))}
      </select>
      <select
        aria-label="Okuma durumu filtresi"
        value={filters.readState ?? ""}
        onChange={(event) =>
          patchFilters({
            readState: (["unread", "reading", "done"] as const).find((state) => state === event.target.value),
          })
        }
        className={selectClass}
      >
        <option value="">Tüm durumlar</option>
        <option value="unread">Okunacak</option>
        <option value="reading">Okuyorum</option>
        <option value="done">Bitti</option>
      </select>
      <label className="flex min-h-[40px] items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
        <input type="checkbox" checked={Boolean(filters.notlu)} onChange={(event) => patchFilters({ notlu: event.target.checked })} className="accent-stone-700" />
        Notlu
      </label>
      <label className="flex min-h-[40px] items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
        <input type="checkbox" checked={Boolean(filters.duzenlenmis)} onChange={(event) => patchFilters({ duzenlenmis: event.target.checked })} className="accent-stone-700" />
        Düzenlenmiş
      </label>
      <label className="flex min-h-[40px] items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
        <input type="checkbox" checked={Boolean(filters.favorite)} onChange={(event) => patchFilters({ favorite: event.target.checked })} className="accent-stone-700" />
        Favori
      </label>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="no-print flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <button
            type="button"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
            className="min-h-[40px] rounded-md border border-stone-300 px-3 text-xs font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 lg:hidden"
          >
            Filtreler{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>

        <input
          type="search"
          value={textDraft}
          onChange={(event) => setTextDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyFilters({ ...filters, q: textDraft.trim() || undefined });
            }
          }}
          placeholder="Belge, düzenlenmiş metin, not ve AI çıktılarında ara…"
          aria-label="Arama"
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-stone-500 focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:placeholder:text-stone-400 dark:focus:border-stone-500"
        />

        <div className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-2 lg:flex`}>{filterPanel}</div>

        {activeCount > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((chip) => (
              <button
                key={chip.kind + chip.label}
                type="button"
                onClick={() => clearChip(chip.kind)}
                className="flex min-h-[32px] items-center gap-1 rounded-full bg-stone-200/80 px-2.5 text-xs text-stone-700 hover:bg-stone-300/70 dark:bg-stone-700/70 dark:text-stone-200 dark:hover:bg-stone-700"
              >
                {chip.label} <span aria-hidden>×</span>
              </button>
            ))}
            <button
              type="button"
              onClick={clearAll}
              className="min-h-[32px] px-2 text-xs text-stone-500 underline underline-offset-2 dark:text-stone-400"
            >
              Tümünü temizle
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-3 px-1 text-xs text-stone-500 dark:text-stone-400">
          <span>{loading ? "Yükleniyor…" : `${docs.length} doküman`}</span>
          {error ? (
            <span role="alert" className="text-red-600 dark:text-red-400">{error}</span>
          ) : null}
        </div>
      </div>

      <div className={loading ? "opacity-55 transition-opacity" : "transition-opacity"}>
        {error && docs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-red-300 px-6 py-10 text-center text-sm text-red-600 dark:border-red-800 dark:text-red-400">
            {error}
          </div>
        ) : (
          <DocumentList
            docs={docs}
            outputsByDoc={outputsByDoc}
            emptyMessage={
              activeCount > 0
                ? "Bu filtrelerle eşleşen doküman yok — filtreleri temizleyip tekrar dene."
                : undefined
            }
          />
        )}
      </div>

      {hasMore && !loading ? (
        <button
          type="button"
          onClick={() => runFetch(filters, docs.length)}
          className="no-print mx-auto min-h-[40px] rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          Daha fazla yükle
        </button>
      ) : null}
    </div>
  );
}
