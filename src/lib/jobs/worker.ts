import type { SqliteDb } from "../db/connection";
import {
  getDocument,
  type DocumentRow,
} from "../db/repo/documents";
import { claimNextJob, completeJob, failJob, type JobRow } from "../db/repo/jobs";
import { getMeta, setMeta } from "../db/repo/meta";
import { buildPromptForJob } from "../ai/instructions";
import {
  agentTimeoutMs,
  resolveAdapter,
  type AgentAdapter,
  type AgentRuntimeInfo,
} from "../agent";

export const HEARTBEAT_KEY = "worker_heartbeat";
export const HEARTBEAT_MAX_AGE_MS = 20_000;

export interface WorkerHeartbeat {
  ts: string;
  agentMode: AgentRuntimeInfo["mode"];
  agentName: string | null;
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

/** Tek job'ı uçtan uca işletir: prompt üret -> agent çalıştır -> çıktı kaydet. */
export async function processJob(
  db: SqliteDb,
  adapter: AgentAdapter,
  job: JobRow,
): Promise<void> {
  const doc: DocumentRow | null = getDocument(db, job.document_id);
  if (!doc) {
    failJob(db, job.id, `Doküman bulunamadı (id=${job.document_id})`);
    return;
  }
  const prompt = buildPromptForJob(job.operation, job.summary_level, doc.original_text);
  const result = await adapter.run({ prompt, timeoutMs: agentTimeoutMs() });
  completeJob(db, {
    jobId: job.id,
    content: result.text,
    agentName: adapter.name,
    agentMetadata: JSON.stringify(result.meta),
  });
}

export interface WorkerOptions {
  pollIntervalMs?: number;
  /** Agent bulunamadığında yeniden tespit deneme aralığı. */
  detectIntervalMs?: number;
}

/**
 * Pending job'ları alan, agent adapter'ı üzerinden işleyen ve kalp atışını
 * meta tablosuna yazan yerel worker döngüsü.
 */
export class ReadflowWorker {
  private stopped = false;
  private current: Promise<void> | null = null;

  constructor(
    private readonly db: SqliteDb,
    private readonly options: WorkerOptions = {},
  ) {}

  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<void> {
    const pollIntervalMs = this.options.pollIntervalMs ?? 2_000;
    const detectIntervalMs = this.options.detectIntervalMs ?? 30_000;

    const recovered = this.db
      .prepare(`UPDATE jobs SET status='pending', started_at=NULL WHERE status='processing'`)
      .run().changes;
    if (recovered > 0) {
      console.log(`[worker] ${recovered} yarım kalmış job kuyruğa alındı`);
    }

    let resolution = resolveAdapter();
    let lastDetect = Date.now();
    let lastError: string | undefined;

    while (!this.stopped) {
      try {
        if (!resolution.adapter && Date.now() - lastDetect > detectIntervalMs) {
          resolution = resolveAdapter();
          lastDetect = Date.now();
        }
        const adapter = resolution.adapter;
        writeHeartbeat(this.db, {
          ts: new Date().toISOString(),
          agentMode: resolution.info.mode,
          agentName: adapter?.name ?? null,
          message: resolution.info.message,
          lastError,
        });

        if (!adapter) {
          await sleep(Math.min(pollIntervalMs * 5, detectIntervalMs / 3));
          continue;
        }

        const job = claimNextJob(this.db);
        if (!job) {
          await sleep(pollIntervalMs);
          continue;
        }
        this.current = processJob(this.db, adapter, job)
          .then(() => {
            lastError = undefined;
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            lastError = message;
            failJob(this.db, job.id, message);
            console.error(`[worker] job #${job.id} başarısız: ${message}`);
          })
          .finally(() => {
            this.current = null;
          });
        await this.current;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[worker] döngü hatası: ${lastError}`);
        await sleep(pollIntervalMs);
      }
    }

    writeHeartbeat(this.db, {
      ts: new Date().toISOString(),
      agentMode: "none",
      agentName: null,
      message: "worker durduruldu",
      lastError,
    });
  }

  async stopAndWait(): Promise<void> {
    this.stop();
    if (this.current) await this.current;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
