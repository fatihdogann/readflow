import Link from "next/link";
import type { DocumentRow } from "@/lib/db/repo/documents";
import { isSummaryLevel, operationLabel } from "@/lib/types";

export type OutputBadge = { operation: "readability" | "summary"; summary_level: string };

function previewOf(doc: DocumentRow): string {
  const text = doc.original_text.replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

export function DocumentList({
  docs,
  outputsByDoc,
}: {
  docs: DocumentRow[];
  outputsByDoc: Map<number, OutputBadge[]>;
}) {
  if (docs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 px-6 py-10 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
        Burada henüz bir şey yok. Ana sayfadan bir bağlantı veya metin ekleyerek başla.
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {docs.map((doc) => {
        const badges = outputsByDoc.get(doc.id) ?? [];
        return (
          <li key={doc.id} className="border-b border-stone-200 last:border-0 dark:border-stone-800">
            <Link
              href={`/doc/${doc.id}`}
              className="group block px-2 py-4 transition-colors hover:bg-stone-100/70 dark:hover:bg-stone-800/40"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium leading-snug text-stone-900 group-hover:underline dark:text-stone-100">
                  {doc.title || "Adsız"}
                </h3>
                {doc.favorite ? (
                  <span className="shrink-0 text-amber-500" title="Favori">
                    ★
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                <span>{doc.source_domain ?? "metin"}</span>
                <span aria-hidden>·</span>
                <span>{dateOf(doc.created_at)}</span>
                {badges.map((badge, index) => (
                  <span
                    key={index}
                    className="rounded bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium text-stone-600 dark:bg-stone-700/70 dark:text-stone-300"
                  >
                    {badge.operation === "summary" && isSummaryLevel(badge.summary_level)
                      ? `Özet · ${badge.summary_level === "short" ? "Kısa" : badge.summary_level === "normal" ? "Normal" : "Detaylı"}`
                      : operationLabel[badge.operation]}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                {previewOf(doc)}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
