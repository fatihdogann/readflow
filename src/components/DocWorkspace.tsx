"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FolderRow } from "@/lib/db/repo/folders";
import type { OutputRow } from "@/lib/db/repo/outputs";
import type { DocumentDetail } from "@/lib/documents/service";
import {
  jobStatusLabel,
  operationLabel,
  summaryLevelLabel,
  SUMMARY_LEVELS,
  type JobStatus,
  type SummaryLevel,
} from "@/lib/types";
import { ExportMenu } from "./ExportMenu";

type TabKey = "original" | "readability" | "summary";

const ALL_LEVELS: SummaryLevel[] = [...SUMMARY_LEVELS];

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="article">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function statusBadgeClass(status: JobStatus): string {
  switch (status) {
    case "pending":
      return "bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300";
    case "processing":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300";
    case "completed":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300";
    case "failed":
      return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
  }
}

export function DocWorkspace({
  initial,
  folders,
}: {
  initial: DocumentDetail;
  folders: FolderRow[];
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<DocumentDetail>(initial);
  const [tab, setTab] = useState<TabKey>("original");
  const [viewLevel, setViewLevel] = useState<SummaryLevel>("normal");
  const [actionLevel, setActionLevel] = useState<SummaryLevel>("normal");
  const [notice, setNotice] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [noteDraft, setNoteDraft] = useState(initial.document.note ?? "");
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);

  const { document: doc, outputs, jobs, tags } = detail;
  const hasActiveJobs = jobs.some((job) => job.status === "pending" || job.status === "processing");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents/${doc.id}`, { cache: "no-store" });
      if (response.ok) setDetail((await response.json()) as DocumentDetail);
    } catch {
      /* yoksay */
    }
  }, [doc.id]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [hasActiveJobs, refresh]);

  const readabilityOutput = useMemo(
    () => outputs.find((output) => output.operation === "readability") ?? null,
    [outputs],
  );
  const summaryOutputFor = useCallback(
    (level: SummaryLevel): OutputRow | null =>
      outputs.find(
        (output) => output.operation === "summary" && output.summary_level === level,
      ) ?? null,
    [outputs],
  );
  const activeSummaryLevels = useMemo(
    () => ALL_LEVELS.filter((level) => summaryOutputFor(level) !== null),
    [summaryOutputFor],
  );

  const isActive = (operation: string, level?: string): boolean =>
    jobs.some(
      (job) =>
        job.status !== "completed" &&
        job.status !== "failed" &&
        job.operation === operation &&
        (level === undefined || job.summary_level === level),
    );

  const showReadabilityTab = readabilityOutput !== null || isActive("readability");
  const showSummaryTab =
    activeSummaryLevels.length > 0 || ALL_LEVELS.some((level) => isActive("summary", level));
  const activeSummaryOutput = summaryOutputFor(viewLevel);

  // Görünür sekmelerden biri kaybolduysa render sırasında "original"e düş (effect'siz türetme).
  const effectiveTab: TabKey =
    tab === "readability" && !showReadabilityTab
      ? "original"
      : tab === "summary" && !showSummaryTab
        ? "original"
        : tab;

  async function createJob(operation: "readability" | "summary", level?: SummaryLevel) {
    setBusyAction(true);
    setNotice(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, operation, summaryLevel: level }),
      });
      const body = (await response.json()) as { job?: typeof jobs[number]; error?: string };
      if (!response.ok || !body.job) {
        setNotice(body.error ?? "İş kuyruğa eklenemedi");
        return;
      }
      setDetail((prev) => ({ ...prev, jobs: [body.job!, ...prev.jobs] }));
      if (operation === "readability") setTab("readability");
      else {
        setTab("summary");
        setViewLevel(level ?? "normal");
      }
    } catch {
      setNotice("Sunucuya ulaşılamadı");
    } finally {
      setBusyAction(false);
    }
  }

  async function retryJob(jobId: number) {
    await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
    await refresh();
  }

  async function patchDocument(body: Record<string, unknown>) {
    const response = await fetch(`/api/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) setDetail((await response.json()) as DocumentDetail);
  }

  async function saveNote() {
    setNoteSaving(true);
    setNotice(null);
    try {
      await patchDocument({ note: noteDraft });
      setNoteDirty(false);
    } finally {
      setNoteSaving(false);
    }
  }

  async function saveTags(next: string[]) {
    const response = await fetch(`/api/documents/${doc.id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: next }),
    });
    if (response.ok) {
      const body = (await response.json()) as { tags: string[] };
      setDetail((prev) => ({ ...prev, tags: body.tags }));
    }
  }

  async function deleteDocument() {
    if (!window.confirm("Bu doküman ve tüm çıktıları silinsin mi?")) return;
    await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    router.push("/history");
  }

  const buttonPrimary =
    "rounded-md bg-stone-900 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white";

  const recentJobs = jobs.slice(0, 4);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Üst bilgi */}
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold leading-snug tracking-tight md:text-2xl">
            {doc.title}
          </h1>
          <div className="no-print flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void patchDocument({ favorite: doc.favorite === 0 })}
              className="rounded px-1.5 py-1 text-lg leading-none hover:bg-stone-200/60 dark:hover:bg-stone-800"
              title={doc.favorite ? "Favoriden çıkar" : "Favoriye ekle"}
            >
              {doc.favorite ? <span className="text-amber-500">★</span> : <span className="text-stone-400">☆</span>}
            </button>
            <button
              type="button"
              onClick={() => void deleteDocument()}
              className="rounded px-1.5 py-1 text-sm text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              title="Dokümanı sil"
            >
              Sil
            </button>
          </div>
        </div>

        <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-stone-500 dark:text-stone-400">
          {doc.source_url ? (
            <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {doc.source_domain ?? doc.source_url}
            </a>
          ) : (
            <span>Yapıştırılan metin</span>
          )}
          {doc.author ? <span>Yazar: {doc.author}</span> : null}
          {doc.published_at ? <span>Yayın: {doc.published_at.slice(0, 10)}</span> : null}
          <span>Arşiv: {doc.created_at.slice(0, 10)}</span>
          <label className="ml-auto flex items-center gap-1">
            <span>Klasör:</span>
            <select
              value={doc.folder_id === null ? "" : String(doc.folder_id)}
              onChange={(event) =>
                void patchDocument({
                  folderId: event.target.value === "" ? null : Number(event.target.value),
                })
              }
              className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs outline-none dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="">Klasörsüz</option>
              {folders.map((folder) => (
                <option key={folder.id} value={String(folder.id)}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="no-print flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-stone-200/80 px-2.5 py-0.5 text-xs text-stone-600 dark:bg-stone-700/70 dark:text-stone-300"
            >
              {tag}
              <button
                type="button"
                className="text-stone-400 hover:text-red-500"
                onClick={() => void saveTags(tags.filter((candidate) => candidate !== tag))}
                title="Etiketi kaldır"
              >
                ×
              </button>
            </span>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = tagInput.trim();
              if (!value) return;
              setTagInput("");
              void saveTags([...tags, value]);
            }}
          >
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="+ etiket"
              className="w-24 rounded-full border border-dashed border-stone-300 bg-transparent px-2.5 py-0.5 text-xs outline-none placeholder:text-stone-400 focus:border-stone-500 dark:border-stone-700"
            />
          </form>
        </div>
      </header>

      {/* AI işlemleri */}
      <section className="no-print flex flex-col gap-3 border-y border-stone-200 py-4 dark:border-stone-800">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonPrimary}
            disabled={busyAction || isActive("readability")}
            onClick={() => void createJob("readability")}
          >
            {isActive("readability") ? "Okunabilirlik işleniyor…" : "Okunabilirliği Artır"}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-stone-300 dark:border-stone-700">
              {ALL_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setActionLevel(level)}
                  className={`px-2.5 py-1.5 text-xs ${
                    actionLevel === level
                      ? "bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-stone-100"
                      : "text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                  }`}
                >
                  {summaryLevelLabel[level]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={buttonPrimary}
              disabled={busyAction || isActive("summary", actionLevel)}
              onClick={() => void createJob("summary", actionLevel)}
            >
              {isActive("summary", actionLevel) ? "Özet işleniyor…" : "Özetle"}
            </button>
          </div>
        </div>

        {recentJobs.length > 0 ? (
          <div className="flex flex-col gap-1">
            {recentJobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded px-1.5 py-0.5 font-medium ${statusBadgeClass(job.status)}`}
                >
                  {operationLabel[job.operation]}
                  {job.operation === "summary" && job.summary_level
                    ? ` · ${summaryLevelLabel[job.summary_level as SummaryLevel] ?? job.summary_level}`
                    : ""}
                </span>
                <span className={job.status === "failed" ? "text-red-600 dark:text-red-400" : "text-stone-500 dark:text-stone-400"}>
                  {jobStatusLabel[job.status]}
                  {job.status === "failed" && job.error ? `: ${job.error}` : ""}
                </span>
                {job.status === "failed" ? (
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
                    onClick={() => void retryJob(job.id)}
                  >
                    Yeniden dene
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">
            {outputs.length === 0
              ? "Bu doküman için henüz AI çıktısı yok — işlemlerden birini seç. Agent bağlı değilse işler kuyrukta bekler, agent açıldığında işlenir."
              : "Çıktılar arşivde kalıcıdır; aynı işlemi yeniden çalıştırırsan çıktı güncellenir."}
          </p>
        )}
        {notice ? <p className="text-xs text-amber-700 dark:text-amber-400">{notice}</p> : null}
      </section>

      {/* Sekmeler */}
      <nav className="no-print flex flex-wrap items-center gap-1 border-b border-stone-200 dark:border-stone-800">
        {(
          [
            { key: "original", label: "Orijinal", show: true },
            { key: "readability", label: "Okunabilir", show: showReadabilityTab },
            { key: "summary", label: "Özet", show: showSummaryTab },
          ] as Array<{ key: TabKey; label: string; show: boolean }>
        )
          .filter((entry) => entry.show)
          .map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={`border-b-2 px-3 py-2 text-sm ${
                effectiveTab === entry.key
                  ? "border-stone-900 font-medium text-stone-900 dark:border-stone-100 dark:text-stone-100"
                  : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
              }`}
            >
              {entry.label}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-2 py-1">
          {tab === "summary" && activeSummaryLevels.length > 0 ? (
            <div className="flex overflow-hidden rounded-md border border-stone-300 dark:border-stone-700">
              {ALL_LEVELS.filter((level) => activeSummaryLevels.includes(level) || isActive("summary", level)).map(
                (level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setViewLevel(level)}
                    className={`px-2.5 py-1 text-xs ${
                      viewLevel === level
                        ? "bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-stone-100"
                        : "text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                    }`}
                  >
                    {summaryLevelLabel[level]}
                    {isActive("summary", level) ? " …" : ""}
                  </button>
                ),
              )}
            </div>
          ) : null}
          {tab === "readability" && readabilityOutput ? (
            <ExportMenu document={doc} output={readabilityOutput} onMessage={setNotice} />
          ) : null}
          {tab === "summary" && activeSummaryOutput ? (
            <ExportMenu document={doc} output={activeSummaryOutput} onMessage={setNotice} />
          ) : null}
        </div>
      </nav>

      {/* İçerik */}
      <div id="print-root" className="min-w-0">
        {effectiveTab === "original" ? (
          doc.source_type === "url" && doc.original_html ? (
            <article className="article" dangerouslySetInnerHTML={{ __html: doc.original_html }} />
          ) : (
            <div className="article whitespace-pre-wrap">{doc.original_text}</div>
          )
        ) : null}
        {effectiveTab === "readability" ? (
          readabilityOutput ? (
            <MarkdownBlock content={readabilityOutput.content} />
          ) : (
            <p className="text-sm text-stone-500">Okunabilirlik çalışması kuyrukta — burada görünecek.</p>
          )
        ) : null}
        {effectiveTab === "summary" ? (
          activeSummaryOutput ? (
            <MarkdownBlock content={activeSummaryOutput.content} />
          ) : (
            <p className="text-sm text-stone-500">
              {summaryLevelLabel[viewLevel]} özet kuyrukta — tamamlandığında burada görünecek.
            </p>
          )
        ) : null}
      </div>

      {/* Kişisel not */}
      <section className="no-print rounded-lg border border-stone-200 bg-stone-100/50 p-4 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">
            Kişisel Not
          </h2>
          <span className="text-[11px] text-stone-400">
            {noteDirty
              ? "kaydedilmedi"
              : doc.note_updated_at
                ? `son düzenleme: ${doc.note_updated_at.slice(0, 16).replace("T", " ")}`
                : ""}
          </span>
        </div>
        <textarea
          value={noteDraft}
          onChange={(event) => {
            setNoteDraft(event.target.value);
            setNoteDirty(true);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (noteDirty && !noteSaving) void saveNote();
            }
          }}
          placeholder="Bu dokümanla ilgili kendi notunu ekle… (⌘/Ctrl+Enter kaydeder)"
          rows={3}
          className="w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-stone-400 focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:placeholder:text-stone-500 dark:focus:border-stone-500"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveNote()}
            disabled={!noteDirty || noteSaving}
            className={buttonPrimary}
          >
            {noteSaving ? "Kaydediliyor…" : "Notu Kaydet"}
          </button>
        </div>
      </section>
    </div>
  );
}
