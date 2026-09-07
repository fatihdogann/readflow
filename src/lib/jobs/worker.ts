import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../db/connection";
import { getDocument } from "../db/repo/documents";
import { getMeta, setMeta } from "../db/repo/meta";
import { getProfile, listProfiles, setValidationResult } from "../db/repo/agentProfiles";
import {
  claimNextJob,
  completeJob,
  DEFAULT_LEASE_MS,
  failJob,
  finalizeCancel,
  isCancelRequested,
  recoverExpiredLeases,
  releaseJob,
  renewLease,
  type AiConfigSnapshot,
  type JobRow,
} from "../db/repo/jobs";
import { buildPromptForSnapshot } from "../ai/instructions";
import { buildChatPromptForJob } from "./chat-context";
import { adapterForJobConfig, provenanceFor, createProfileAdapter, runProfileValidation } from "../agent/profiles";
import { agentTimeoutMs, resolveAdapter, type AgentAdapter, type AgentRuntimeInfo } from "../agent";
import { safeParseConfig } from "./create";

export const HEARTBEAT_KEY = "worker_heartbeat";
export const HEARTBEAT_MAX_AGE_MS = 20_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const LEASE_CHECK_INTERVAL_MS = 30_000;

export interface WorkerHeartbeat {
  ts: string;
  agentMode: AgentRuntimeInfo["mode"];
  agentName: string | null;
  fallbackAgentName?: string | null;
  currentJobId?: number | null;
  workerId: string;
  message?: string;
  lastError?: string;
}

export function readHeartbeat(db: SqliteDb): WorkerHeartbeat | null {
  const raw = getMeta(db, HEARTBEAT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkerHeartbeat;
  } catch {
    return null;
  }
}

export function writeHeartbeat(db: SqliteDb, beat: WorkerHeartbeat): void {
  setMeta(db, HEARTBEAT_KEY, JSON.stringify(beat));
}

export function isHeartbeatFresh(beat: WorkerHeartbeat | null): boolean {
  if (!beat) return false;
  const age = Date.now() - new Date(beat.ts).getTime();
  return age >= 0 && age < HEARTBEAT_MAX_AGE_MS;
}

/** İşin sabitlenmiş metni yoksa (eski iş) claim anında kaynak metni işe yazar. */
function ensureSnapshotText(db: SqliteDb, job: JobRow): string {
  if (job.source_text.trim()) return job.source_text;
  const doc = getDocument(db, job.document_id);
  const text = doc?.original_text ?? "";
  db.prepare(`UPDATE jobs SET source_text = ?, source_kind = ? WHERE id = ?`).run(
    text,
    "original",
    job.id,
  );
  return text;
}

function parseImages(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Birincil adapter başarısız olursa sırayla denenecek yedek profiller (jcode → codex → claude). */
const FALLBACK_ORDER = ["jcode", "codex", "claude"] as const;

function buildFallbackAdapters(db: SqliteDb, aiConfig: AiConfigSnapshot | null): AgentAdapter[] {
  const enabled = listProfiles(db).filter((profile) => profile.enabled === 1);
  const primaryCli = aiConfig?.cli;
  const ordered: typeof enabled = [];
  for (const cli of FALLBACK_ORDER) {
    const match = enabled.find((profile) => profile.cli === cli);
    if (match && match.cli !== primaryCli) ordered.push(match);
  }
  for (const profile of enabled) {
    if (!ordered.some((candidate) => candidate.id === profile.id)) ordered.push(profile);
  }
  return ordered
    .filter((profile) => profile.cli !== primaryCli)
    .map((profile) =>
      createProfileAdapter({
        cli: profile.cli,
        model: profile.model,
        provider: profile.provider,
        transport: profile.transport,
        timeout_ms: profile.timeout_ms,
      }),
    );
}

/** Tek job'ı uçtan uca işletir: snapshot'tan prompt üret -> adapter çalıştır -> çıktı kaydet. */
export async function processJob(
  db: SqliteDb,
  adapter: AgentAdapter,
  job: JobRow,
  workerId: string,
): Promise<void> {
  const sourceText = ensureSnapshotText(db, job);
  const aiConfig = safeParseConfig(job.ai_config);
  // Chat: soru + sınırlı geçmiş saklı mesajlardan; diğer işler snapshot metninden.
  const prompt =
    job.operation === "chat"
      ? buildChatPromptForJob(db, job)
      : buildPromptForSnapshot({
          operation: job.operation,
          summaryLevel: job.summary_level,
          sourceText,
          notesIncluded: job.notes_included === 1,
          notesText: job.notes_text,
          images: parseImages(job.source_images),
        });
  const snapshotTimeout = aiConfig?.kind === "profile" ? aiConfig.timeout_ms : undefined;
  const timeoutMs =
    typeof snapshotTimeout === "number" && Number.isFinite(snapshotTimeout) && snapshotTimeout >= 1_000
      ? Math.min(snapshotTimeout, 30 * 60 * 1_000)
      : agentTimeoutMs();

  // Birincil adapter başarısız olursa yedek profiller sırayla denenir
  // (jcode → codex → claude sırası); hepsi başarısızsa son hata fırlatılır.
  const fallbackAdapters = buildFallbackAdapters(db, aiConfig);
  const attempts: Array<{ adapter: AgentAdapter; label: string }> = [
    { adapter, label: adapter.name },
    ...fallbackAdapters.map((fallback) => ({ adapter: fallback, label: fallback.name })),
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const result = await attempt.adapter.run({ prompt, timeoutMs });
      completeWithProvenance(db, job, workerId, aiConfig, attempt.label, result.text, result.meta);
      return;
    } catch (runError) {
      lastError = runError;
      // Kullanıcı iptal ettiyse denemeleri durdur
      if (isCancelRequested(db, job.id)) throw runError;
    }
  }
  throw lastError ?? new Error("Tüm adapter denemeleri başarısız");
}

function completeWithProvenance(
  db: SqliteDb,
  job: JobRow,
  workerId: string,
  aiConfig: AiConfigSnapshot | null,
  agentName: string,
  text: string,
  meta: Record<string, unknown>,
): void {
  completeJob(db, {
    jobId: job.id,
    owner: workerId,
    content: text,
    agentName,
    agentMetadata: JSON.stringify({ ...provenanceFor(aiConfig, agentName), ...meta }),
  });
}

export interface WorkerOptions {
  pollIntervalMs?: number;
  detectIntervalMs?: number;
}

/**
 * Pending job'ları lease ile alan, kalp atışını AI çağrısından bağımsız
 * tutan yerel worker döngüsü. Adapter tespiti başlangıçta bir kez yapılır;
 * agent yoksa periyodik yeniden denenir.
 */
export class ReadflowWorker {
  readonly workerId = `worker-${randomUUID()}`;
  readonly initialResolution: { adapter: AgentAdapter | null; info: AgentRuntimeInfo };
  private stopped = false;
  private currentJobId: number | null = null;
  private currentAgentName: string | null = null;
  private currentJobAdapter: AgentAdapter | null = null;
  private current: Promise<void> | null = null;
  private lastError: string | undefined;

  constructor(
    private readonly db: SqliteDb,
    private readonly options: WorkerOptions = {},
  ) {
    this.initialResolution = resolveAdapter();
  }

  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<void> {
    const pollIntervalMs = this.options.pollIntervalMs ?? 2_000;
    const detectIntervalMs = this.options.detectIntervalMs ?? 30_000;
    let resolution = this.initialResolution;
    let lastDetect = Date.now();
    let lastLeaseCheck = 0;

    // Kalp atışı AI çağrısından bağımsız interval'de: uzun işlem "worker kapalı"
    // yanılgısına ve lease dolmasına yol açmaz.
    const beat = setInterval(() => {
      try {
        writeHeartbeat(this.db, {
          ts: new Date().toISOString(),
          agentMode: resolution.info.mode,
          agentName: this.currentAgentName ?? resolution.adapter?.name ?? null,
          fallbackAgentName: resolution.adapter?.name ?? null,
          currentJobId: this.currentJobId,
          workerId: this.workerId,
          message: resolution.info.message,
          lastError: this.lastError,
        });
        if (this.currentJobId !== null) {
          renewLease(this.db, this.currentJobId, this.workerId, DEFAULT_LEASE_MS);
          // Kullanıcı iptal ettiyse çalışan CLI sürecini gerçekten sonlandır.
          if (isCancelRequested(this.db, this.currentJobId)) {
            this.currentJobAdapter?.abort?.();
          }
        }
      } catch {
        /* kalp atışı hatası döngüyü bozmaz */
      }
    }, HEARTBEAT_INTERVAL_MS);

    try {
      while (!this.stopped) {
        try {
          if (Date.now() - lastLeaseCheck > LEASE_CHECK_INTERVAL_MS) {
            // Yalnızca süresi dolmuş lease'ler kurtarılır; toplu geri alma yok.
            recoverExpiredLeases(this.db);
            lastLeaseCheck = Date.now();
          }

          // Bekleyen profil doğrulama isteği varsa yerelde çalıştır
          const validateRaw = getMeta(this.db, "profile_validate_request");
          if (validateRaw) {
            try {
              const parsed = JSON.parse(validateRaw) as { profileId?: number };
              if (parsed.profileId) {
                const profile = getProfile(this.db, parsed.profileId);
                if (profile) {
                  const adapter = createProfileAdapter(profile);
                  const outcome = await runProfileValidation(adapter, profile.timeout_ms);
                  setValidationResult(this.db, profile.id, outcome.ok, outcome.ok ? null : outcome.message.slice(0, 400));
                  setMeta(this.db, "profile_validate_request", "");
                  console.log(`[worker] profil #${profile.id} doğrulaması: ${outcome.ok ? "başarılı" : "başarısız"}`);
                } else {
                  setMeta(this.db, "profile_validate_request", "");
                }
              } else {
                setMeta(this.db, "profile_validate_request", "");
              }
            } catch (validateError) {
              console.error(`[worker] doğrulama hatası: ${validateError instanceof Error ? validateError.message : validateError}`);
              setMeta(this.db, "profile_validate_request", "");
            }
          }

          if (!resolution.adapter && Date.now() - lastDetect > detectIntervalMs) {
            resolution = resolveAdapter();
            lastDetect = Date.now();
          }
          if (!resolution.adapter) {
            await sleep(Math.min(pollIntervalMs * 5, detectIntervalMs / 3));
            continue;
          }

          const job = claimNextJob(this.db, this.workerId);
          if (!job) {
            await sleep(pollIntervalMs);
            continue;
          }

          const aiConfig = safeParseConfig(job.ai_config);
          // Profil snapshot'ı kendi adapter'ını taşır; env/auto için ortam adapter'ı gerekir.
          const jobAdapter =
            aiConfig?.kind === "profile" ? adapterForJobConfig(aiConfig).adapter : resolution.adapter;
          if (!jobAdapter) {
            releaseJob(this.db, job.id, this.workerId);
            await sleep(pollIntervalMs);
            continue;
          }

          this.currentJobId = job.id;
          this.currentAgentName = jobAdapter.name;
          this.currentJobAdapter = jobAdapter;
          this.current = processJob(this.db, jobAdapter, job, this.workerId)
            .then(() => {
              this.lastError = undefined;
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              // Kullanıcı iptal ettiyse bunu "Hata" olarak yazma; iptali kesinleştir.
              if (isCancelRequested(this.db, job.id) && finalizeCancel(this.db, job.id, this.workerId)) {
                this.lastError = undefined;
                return;
              }
              this.lastError = message;
              try {
                failJob(this.db, job.id, this.workerId, message);
              } catch {
                /* sahiplik başka ele geçmişse dokunma */
              }
              console.error(`[worker] job #${job.id} başarısız: ${message}`);
            })
            .finally(() => {
              this.currentJobId = null;
              this.currentAgentName = null;
              this.currentJobAdapter = null;
              this.current = null;
            });
          await this.current;
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          console.error(`[worker] döngü hatası: ${this.lastError}`);
          await sleep(pollIntervalMs);
        }
      }
    } finally {
      clearInterval(beat);
      writeHeartbeat(this.db, {
        ts: new Date().toISOString(),
        agentMode: "none",
        agentName: null,
        workerId: this.workerId,
        message: "worker durduruldu",
        lastError: this.lastError,
      });
    }
  }

  async stopAndWait(): Promise<void> {
    this.stop();
    if (this.current) await this.current;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
