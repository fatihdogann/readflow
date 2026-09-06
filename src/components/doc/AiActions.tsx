"use client";

import { useEffect, useMemo, useState } from "react";
import { mutateJson } from "@/lib/client/api";
import type { DocumentDetail } from "@/lib/documents/service";
import type { JobRow } from "@/lib/db/repo/jobs";
import { jobStatusLabel, operationLabel, summaryLevelLabel, SUMMARY_LEVELS, type JobStatus, type SummaryLevel } from "@/lib/types";
import { ChevronDownIcon, LockIcon } from "@/components/Icons";

interface StatusResponse {
  workerAlive: boolean;
  agentMode: "command" | "mock" | "none" | null;
  agentName: string | null;
  currentJobId: number | null;
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

function statusBadgeClass(status: JobStatus, cancelled?: boolean): string {
  if (cancelled) return "bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300";
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
    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const response = await fetch("/api/agent/status", { cache: "no-store" });
        if (response.ok && !cancelled) setStatus((await response.json()) as StatusResponse);
      } catch {
        /* durum alınamadı: Otomatik varsayılan */
      }
    };
    const initial = setTimeout(() => void refreshStatus(), 0);
    const timer = setInterval(() => void refreshStatus(), 5_000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);

  const activeJobFor = (operation: string, level?: string): JobRow | undefined =>
    detail.jobs.find(
      (job) =>
        (job.status === "pending" || job.status === "processing") &&
        job.operation === operation &&
        (level === undefined || job.summary_level === level),
    );

  const hasEdit = detail.edit !== null;
  const recentJobs = useMemo(() => {
    const seen = new Set<string>();
    return detail.jobs
      .filter((job) => {
        const key = `${job.operation}:${job.summary_level}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [detail.jobs]);

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

  async function cancel(jobId: number): Promise<void> {
    onNotice("");
    try {
      const body = await mutateJson<{ job: JobRow }>(`/api/jobs/${jobId}/cancel`, "POST");
      onJobsChange([body.job, ...detail.jobs.filter((job) => job.id !== jobId)]);
      onNotice(body.job.cancelled === 1 ? "İş iptal edildi." : "İptal talebi alındı; süreç sonlandırılıyor.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "İptal edilemedi");
    }
  }

  const radioClass = (checked: boolean) =>
    `flex min-h-[36px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${
      checked
        ? "bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-stone-100"
        : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
    }`;

  const aiOptions = useMemo(() => (status?.profiles ?? []).filter((profile) => profile.enabled), [status]);
  const selectedProfile =
    aiOptions.find((profile) => profile.id === selection.aiProfileId) ??
    aiOptions.find((profile) => profile.id === status?.defaultProfileId) ??
    null;
  const sourceLabel =
    selection.sourceKind === "original"
      ? "Orijinal"
      : selection.sourceKind === "edited"
        ? "Düzenlenmiş"
        : hasEdit
          ? "Düzenlenmiş (otomatik)"
          : "Orijinal (otomatik)";
  const configLabel = `${selectedProfile?.name ?? "Otomatik AI"} · ${sourceLabel}${selection.includeNotes ? " · Not dahil" : ""}`;

  return (
    <section className="no-print flex flex-col gap-4 rounded-2xl border border-stone-200 bg-stone-100/55 p-4 shadow-[0_12px_36px_rgba(28,25,23,0.045)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none" aria-label="AI işlemleri">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Metni işle</h2>
          <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">{configLabel}</p>
        </div>
        {status?.currentJobId ? (
          <span className="flex items-center gap-2 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
            {status.agentName ?? "AI"} işliyor
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-[0_5px_16px_rgba(28,25,23,0.16)] transition hover:-translate-y-px hover:bg-stone-700 disabled:translate-y-0 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:shadow-none dark:hover:bg-white"
          disabled={busy || Boolean(activeJobFor("readability"))}
          onClick={() => void createJob("readability")}
        >
          {activeJobFor("readability") ? "Okunabilirlik işleniyor…" : "Okunabilirliği artır"}
        </button>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Özet seviyesi" className="flex overflow-hidden rounded-lg border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900">
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
            className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-[0_5px_16px_rgba(28,25,23,0.16)] transition hover:-translate-y-px hover:bg-stone-700 disabled:translate-y-0 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:shadow-none dark:hover:bg-white"
            disabled={busy || Boolean(activeJobFor("summary", selection.summaryLevel))}
            onClick={() => void createJob("summary", selection.summaryLevel)}
          >
            {activeJobFor("summary", selection.summaryLevel) ? "Özet işleniyor…" : "Özetle"}
          </button>
        </div>
      </div>

      <details className="group rounded-xl border border-stone-200 bg-white/70 dark:border-stone-800 dark:bg-stone-950/25">
        <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-stone-700 marker:hidden hover:text-stone-950 dark:text-stone-300 dark:hover:text-white">
          <span>Çalıştırma ayarları</span>
          <ChevronDownIcon size={16} className="text-stone-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-200 px-3 py-3 text-xs dark:border-stone-800">
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
              <span className="inline-flex items-center gap-1.5"><LockIcon size={14} /> Environment tarafından yönetiliyor</span>
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
      </details>

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
            const cancelled = job.cancelled === 1;
            const pendingReason =
              job.status === "pending" && status && !status.workerAlive
                ? "Agent bağlı değil — worker açılınca işlenir"
                : job.status === "pending" && status?.envLock.locked && status.agentMode === "none"
                  ? "Agent bağlantısı devre dışı"
                  : null;
            return (
              <div key={job.id} className="flex flex-wrap items-center gap-2 border-t border-stone-200/80 pt-2 text-xs first:border-0 first:pt-0 dark:border-stone-800">
                <span className={`rounded px-1.5 py-0.5 font-medium ${statusBadgeClass(job.status, cancelled)}`}>
                  {operationLabel[job.operation]}
                  {job.operation === "summary" && job.summary_level
                    ? ` · ${summaryLevelLabel[job.summary_level as SummaryLevel]}`
                    : ""}
                </span>
                <span className={job.status === "failed" && !cancelled ? "text-red-600 dark:text-red-400" : "text-stone-600 dark:text-stone-400"}>
                  {cancelled ? "İptal edildi" : (pendingReason ?? jobStatusLabel[job.status])}
                  {job.status === "failed" && !cancelled && job.error ? `: ${job.error}` : ""}
                </span>
                {config?.name || config?.cli ? (
                  <span className="text-stone-500 dark:text-stone-400">
                    ({config.name ?? config.cli}
                    {config.model ? ` · ${config.model}` : ""})
                  </span>
                ) : null}
                {detail.jobs.filter((candidate) => candidate.operation === job.operation && candidate.summary_level === job.summary_level).length > 1 ? (
                  <span className="text-stone-500 dark:text-stone-400">
                    {detail.jobs.filter((candidate) => candidate.operation === job.operation && candidate.summary_level === job.summary_level).length} çalışma
                  </span>
                ) : null}
                {job.status === "failed" && !cancelled ? (
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
                ) : job.status === "pending" || job.status === "processing" ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      className="min-h-[32px] underline underline-offset-2 hover:text-stone-900 disabled:opacity-40 dark:hover:text-stone-100"
                      onClick={() => void cancel(job.id)}
                    >
                      İptal et
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="min-h-[32px] underline underline-offset-2 hover:text-stone-900 disabled:opacity-40 dark:hover:text-stone-100"
                      onClick={() =>
                        void createJob(
                          job.operation,
                          (job.summary_level || undefined) as SummaryLevel | undefined,
                          true,
                        )
                      }
                    >
                      İptal et ve mevcut ayarlarla yeniden başlat
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
