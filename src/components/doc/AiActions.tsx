"use client";

import { useEffect, useMemo, useState } from "react";
import { mutateJson } from "@/lib/client/api";
import type { DocumentDetail } from "@/lib/documents/service";
import type { JobRow } from "@/lib/db/repo/jobs";
import { jobStatusLabel, operationLabel, summaryLevelLabel, SUMMARY_LEVELS, type JobStatus, type SummaryLevel } from "@/lib/types";

interface StatusResponse {
  workerAlive: boolean;
  agentMode: "command" | "mock" | "none" | null;
  envLock: { locked: boolean; description: string };
  defaultProfileId: number | null;
  profiles: Array<{ id: number; name: string; cli: string; model: string | null; enabled: number }>;
}

export interface AiSelection {
  aiProfileId: number | null; // null = Otomatik
  sourceKind: "auto" | "original" | "edited";
  includeNotes: boolean;
  summaryLevel: SummaryLevel;
}

function parseConfig(raw: string | null): { name?: string; cli?: string; model?: string | null } | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { name?: string; cli?: string; model?: string | null };
  } catch {
    return null;
  }
}

function statusBadgeClass(status: JobStatus): string {
  switch (status) {
    case "pending":
      return "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200";
    case "processing":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300";
    case "completed":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300";
    case "failed":
      return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
  }
}

export function AiActions({
  detail,
  selection,
  onSelectionChange,
  onJobsChange,
  onNotice,
}: {
  detail: DocumentDetail;
  selection: AiSelection;
  onSelectionChange: (next: AiSelection) => void;
  onJobsChange: (jobs: JobRow[]) => void;
  onNotice: (message: string) => void;
}) {
  const doc = detail.document;
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [rerunJob, setRerunJob] = useState<JobRow | null>(null);

  useEffect(() => {
    const initial = setTimeout(async () => {
      try {
        const response = await fetch("/api/agent/status", { cache: "no-store" });
        if (response.ok) setStatus((await response.json()) as StatusResponse);
      } catch {
        /* durum alınamadı: Otomatik varsayılan */
      }
    }, 0);
    return () => clearTimeout(initial);
  }, []);

  const activeJobFor = (operation: string, level?: string): JobRow | undefined =>
    detail.jobs.find(
      (job) =>
        (job.status === "pending" || job.status === "processing") &&
        job.operation === operation &&
        (level === undefined || job.summary_level === level),
    );

  const hasEdit = detail.edit !== null;
  const recentJobs = detail.jobs.slice(0, 4);

  async function createJob(operation: "readability" | "summary", level?: SummaryLevel, forceNew = false, profileId?: number | null) {
    setBusy(true);
    onNotice("");
    try {
      const body = await mutateJson<{ job: JobRow }>("/api/jobs", "POST", {
        documentId: doc.id,
        operation,
        summaryLevel: level,
        sourceKind: selection.sourceKind,
        includeNotes: selection.includeNotes,
        aiProfileId: profileId !== undefined ? profileId : selection.aiProfileId,
        forceNew,
      });
      onJobsChange([body.job, ...detail.jobs.filter((job) => job.id !== body.job.id)]);
      setRerunJob(null);
      onNotice("");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "İş kuyruğa eklenemedi");
    } finally {
      setBusy(false);
    }
  }

  async function retry(jobId: number): Promise<void> {
    onNotice("");
    try {
      const body = await mutateJson<{ job: JobRow }>(`/api/jobs/${jobId}/retry`, "POST");
      onJobsChange([body.job, ...detail.jobs.filter((job) => job.id !== jobId)]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Yeniden deneme başarısız");
    }
  }

  const radioClass = (checked: boolean) =>
    `flex min-h-[36px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${
      checked
        ? "bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-stone-100"
        : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
    }`;

  const aiOptions = useMemo(() => (status?.profiles ?? []).filter((profile) => profile.enabled), [status]);

  return (
    <section className="no-print flex flex-col gap-3 border-y border-stone-200 py-4 dark:border-stone-800" aria-label="AI işlemleri">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">AI kaynak metni</legend>
          <span className="text-stone-500 dark:text-stone-400">Kaynak:</span>
          {(
            [
              { value: "auto", label: "Otomatik" },
              { value: "original", label: "Orijinal" },
              { value: "edited", label: "Düzenlenmiş" },
            ] as const
          ).map((option) => (
            <label key={option.value} className={radioClass(selection.sourceKind === option.value)}>
              <input
                type="radio"
                name="ai-source"
                value={option.value}
                checked={selection.sourceKind === option.value}
                onChange={() => onSelectionChange({ ...selection, sourceKind: option.value })}
                className="accent-stone-700"
              />
              {option.label}
              {option.value === "edited" && !hasEdit ? <span aria-hidden> (yok)</span> : null}
            </label>
          ))}
        </fieldset>

        <label className="flex min-h-[32px] items-center gap-1.5 text-stone-600 dark:text-stone-400">
          <input
            type="checkbox"
            checked={selection.includeNotes}
            onChange={(event) => onSelectionChange({ ...selection, includeNotes: event.target.checked })}
            className="accent-stone-700"
          />
          Notu AI&apos;a ekle
        </label>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Hangi AI ile çalışsın</legend>
          <span className="text-stone-500 dark:text-stone-400">AI:</span>
          {status?.envLock.locked ? (
            <span
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              title={status.envLock.description}
            >
              🔒 Environment tarafından yönetiliyor
            </span>
          ) : (
            <select
              value={selection.aiProfileId ?? ""}
              onChange={(event) =>
                onSelectionChange({
                  ...selection,
                  aiProfileId: event.target.value === "" ? null : Number(event.target.value),
                })
              }
              aria-label="AI profili"
              className="min-h-[32px] rounded border border-stone-300 bg-white px-1.5 py-1 text-xs outline-none dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="">Otomatik</option>
              {aiOptions.map((profile) => (
                <option key={profile.id} value={String(profile.id)}>
                  {profile.name} ({profile.cli}
                  {profile.model ? ` · ${profile.model}` : ""})
                </option>
              ))}
              {aiOptions.length === 0 ? <option disabled>Ayarlar&apos;dan profil oluştur</option> : null}
            </select>
          )}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-stone-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          disabled={busy || Boolean(activeJobFor("readability"))}
          onClick={() => void createJob("readability")}
        >
          {activeJobFor("readability") ? "Okunabilirlik işleniyor…" : "Okunabilirliği Artır"}
        </button>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Özet seviyesi" className="flex overflow-hidden rounded-md border border-stone-300 dark:border-stone-700">
            {SUMMARY_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={selection.summaryLevel === level}
                onClick={() => onSelectionChange({ ...selection, summaryLevel: level })}
                className={`${radioClass(selection.summaryLevel === level)} rounded-none`}
              >
                {summaryLevelLabel[level]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded-md bg-stone-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            disabled={busy || Boolean(activeJobFor("summary", selection.summaryLevel))}
            onClick={() => void createJob("summary", selection.summaryLevel)}
          >
            {activeJobFor("summary", selection.summaryLevel) ? "Özet işleniyor…" : "Özetle"}
          </button>
        </div>
      </div>

      {rerunJob ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-xs dark:border-stone-700">
          <span>
            “{operationLabel[rerunJob.operation]}
            {rerunJob.operation === "summary" && rerunJob.summary_level
              ? ` · ${summaryLevelLabel[rerunJob.summary_level as SummaryLevel]}`
              : ""}” işini hangi AI ile yeniden çalıştırayım?
          </span>
          <select
            aria-label="Yeniden çalıştırma AI seçimi"
            onChange={(event) => {
              const value = event.target.value;
              void createJob(rerunJob.operation, (rerunJob.summary_level || undefined) as SummaryLevel | undefined, true, value === "" ? null : Number(value));
            }}
            defaultValue=""
            className="min-h-[32px] rounded border border-stone-300 bg-white px-1.5 py-1 dark:border-stone-700 dark:bg-stone-900"
          >
            <option value="" disabled>
              Seç…
            </option>
            <option value="">Otomatik</option>
            {aiOptions.map((profile) => (
              <option key={profile.id} value={String(profile.id)}>
                {profile.name} ({profile.cli})
              </option>
            ))}
          </select>
          <button type="button" className="underline underline-offset-2" onClick={() => setRerunJob(null)}>
            Vazgeç
          </button>
        </div>
      ) : null}

      {recentJobs.length > 0 ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          {recentJobs.map((job) => {
            const config = parseConfig(job.ai_config);
            const pendingReason =
              job.status === "pending" && status && !status.workerAlive
                ? "Agent bağlı değil — worker açılınca işlenir"
                : job.status === "pending" && status?.envLock.locked && status.agentMode === "none"
                  ? "Agent bağlantısı devre dışı"
                  : null;
            return (
              <div key={job.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-medium ${statusBadgeClass(job.status)}`}>
                  {operationLabel[job.operation]}
                  {job.operation === "summary" && job.summary_level
                    ? ` · ${summaryLevelLabel[job.summary_level as SummaryLevel]}`
                    : ""}
                </span>
                <span className={job.status === "failed" ? "text-red-600 dark:text-red-400" : "text-stone-600 dark:text-stone-400"}>
                  {pendingReason ?? jobStatusLabel[job.status]}
                  {job.status === "failed" && job.error ? `: ${job.error}` : ""}
                </span>
                {config?.name || config?.cli ? (
                  <span className="text-stone-500 dark:text-stone-400">
                    ({config.name ?? config.cli}
                    {config.model ? ` · ${config.model}` : ""})
                  </span>
                ) : null}
                {job.status === "failed" ? (
                  <>
                    <button
                      type="button"
                      className="min-h-[32px] underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
                      onClick={() => void retry(job.id)}
                    >
                      Yeniden dene (aynı snapshot)
                    </button>
                    <button
                      type="button"
                      className="min-h-[32px] underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
                      onClick={() => setRerunJob(job)}
                    >
                      Başka AI ile yeniden çalıştır
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Bu doküman için henüz AI çıktısı yok — işlemlerden birini seç. Agent bağlı değilse işler
          kuyrukta bekler, agent açıldığında işlenir.
        </p>
      )}
    </section>
  );
}
