import type { Operation, StoredSummaryLevel } from "../../types";
import type { SqliteDb } from "../connection";
import { nowIso } from "./now";
import { upsertOutput } from "./outputs";

export interface JobRow {
  id: number;
  document_id: number;
  operation: Operation;
  summary_level: StoredSummaryLevel;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreateJobInput {
  documentId: number;
  operation: Operation;
  summaryLevel?: StoredSummaryLevel;
}

export function createJob(db: SqliteDb, input: CreateJobInput): JobRow {
  const level = input.summaryLevel ?? "";
  // Aynı iş için aktif (pending/processing) bir kayıt varsa yenisini açma.
  const existing = db
    .prepare(
      `SELECT * FROM jobs
       WHERE document_id = ? AND operation = ? AND summary_level = ?
         AND status IN ('pending','processing')
       ORDER BY id LIMIT 1`,
    )
    .get(input.documentId, input.operation, level) as JobRow | undefined;
  if (existing) return existing;

  const result = db
    .prepare(
      `INSERT INTO jobs (document_id, operation, summary_level, status, attempts, created_at)
       VALUES (?, ?, ?, 'pending', 0, ?)`,
    )
    .run(input.documentId, input.operation, level, nowIso());
  return getJob(db, Number(result.lastInsertRowid))!;
}

/** Belirli bir pending job'ı atomik olarak claim eder (MCP claim_job için). */
export function claimJobById(db: SqliteDb, jobId: number): JobRow | null {
  const claim = db.transaction((): JobRow | null => {
    const job = getJob(db, jobId);
    if (!job || job.status !== "pending") return null;
    const result = db
      .prepare(
        `UPDATE jobs SET status = 'processing', started_at = ?, attempts = attempts + 1
         WHERE id = ? AND status = 'pending'`,
      )
      .run(nowIso(), jobId);
    if (result.changes === 0) return null;
    return getJob(db, jobId)!;
  });
  return claim.immediate();
}

export function getJob(db: SqliteDb, id: number): JobRow | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ?? null;
}

/**
 * Sıradaki pending job'ı atomik olarak claim eder.
 * BEGIN IMMEDIATE transaction sayesinde aynı job iki worker'a dağılamaz;
 * ikinci worker bu satırı işleyemez (status artık 'processing').
 */
export function claimNextJob(db: SqliteDb): JobRow | null {
  const claim = db.transaction((): JobRow | null => {
    const candidate = db
      .prepare(
        `SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at, id LIMIT 1`,
      )
      .get() as JobRow | undefined;
    if (!candidate) return null;
    const result = db
      .prepare(
        `UPDATE jobs SET status = 'processing', started_at = ?, attempts = attempts + 1
         WHERE id = ? AND status = 'pending'`,
      )
      .run(nowIso(), candidate.id);
    if (result.changes === 0) return null;
    return getJob(db, candidate.id)!;
  });
  return claim.immediate();
}

export interface CompleteJobInput {
  jobId: number;
  content: string;
  agentName?: string | null;
  agentMetadata?: string | null;
}

/** Job'ı tamamlandı işaretler ve çıktıyı (varsa üzerine yazarak) kaydeder. */
export function completeJob(db: SqliteDb, input: CompleteJobInput): { job: JobRow; outputId: number } {
  const tx = db.transaction((): { job: JobRow; outputId: number } => {
    const job = getJob(db, input.jobId);
    if (!job) throw new Error(`Job bulunamadı: ${input.jobId}`);
    if (job.status !== "processing") {
      throw new Error(`Job işlenmiyor durumda değil: ${job.status}`);
    }
    const output = upsertOutput(db, {
      documentId: job.document_id,
      operation: job.operation,
      summaryLevel: job.summary_level,
      content: input.content,
      agentName: input.agentName ?? null,
      agentMetadata: input.agentMetadata ?? null,
    });
    db.prepare(
      `UPDATE jobs SET status = 'completed', completed_at = ?, error = NULL WHERE id = ?`,
    ).run(nowIso(), job.id);
    return { job: getJob(db, job.id)!, outputId: output.id };
  });
  return tx.immediate();
}

export function failJob(db: SqliteDb, jobId: number, error: string): JobRow {
  const tail = error.length > 800 ? `${error.slice(0, 800)}…` : error;
  db.prepare(
    `UPDATE jobs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`,
  ).run(nowIso(), tail, jobId);
  return getJob(db, jobId)!;
}

export function retryJob(db: SqliteDb, jobId: number): JobRow {
  const job = getJob(db, jobId);
  if (!job) throw new Error(`Job bulunamadı: ${jobId}`);
  if (job.status !== "failed") throw new Error("Yalnızca başarısız job yeniden denenebilir");
  if (job.attempts >= 5) throw new Error("Bu job için deneme sınırına ulaşıldı");
  db.prepare(
    `UPDATE jobs SET status = 'pending', error = NULL, started_at = NULL, completed_at = NULL WHERE id = ?`,
  ).run(jobId);
  return getJob(db, jobId)!;
}

/** Tek worker varsayımıyla: açılışta takılı kalmış 'processing' job'ları kuyruğa geri alır. */
export function recoverStaleProcessing(db: SqliteDb): number {
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'pending', started_at = NULL
       WHERE status = 'processing'`,
    )
    .run();
  return result.changes;
}

export function listJobsByDocument(db: SqliteDb, documentId: number, limit = 10): JobRow[] {
  return db
    .prepare(
      `SELECT * FROM jobs WHERE document_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(documentId, limit) as JobRow[];
}

export function countsByStatus(db: SqliteDb): Record<string, number> {
  const rows = db.prepare(`SELECT status, COUNT(*) AS c FROM jobs GROUP BY status`).all() as Array<{
    status: string;
    c: number;
  }>;
  const counts: Record<string, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) counts[row.status] = row.c;
  return counts;
}

export function listPendingJobs(db: SqliteDb, limit = 50): JobRow[] {
  return db
    .prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at, id LIMIT ?`)
    .all(limit) as JobRow[];
}
