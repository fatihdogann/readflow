import { createHash, randomUUID } from "node:crypto";
import type { JobOperation, StoredSummaryLevel } from "../../types";
import type { SqliteDb } from "../connection";
import { nowIso } from "./now";
import { upsertOutput } from "./outputs";
import { findMessageByJob, insertAssistantMessage, setMessageStatus } from "./chat";

export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type SourceKind = "original" | "edited" | "auto";

/** İş oluşturulurken sabitlenen AI yapılandırması (güvenli provenance alanları). */
export interface AiConfigSnapshot {
  kind: "profile" | "auto" | "env";
  profile_id?: number;
  name?: string;
  cli?: string;
  model?: string | null;
  provider?: string | null;
  /** Reasoning effort (low/medium/high/xhigh/max) — CLI desteklemiyorsa argv'ye girmez. */
  effort?: string | null;
  transport?: "stdin" | "argv";
  timeout_ms?: number;
  config_revision?: number;
}

export interface JobRow {
  id: number;
  document_id: number;
  operation: JobOperation;
  summary_level: StoredSummaryLevel;
  status: JobStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  owner: string | null;
  lease_expires_at: string | null;
  source_kind: SourceKind;
  source_text: string;
  source_revision: number;
  notes_included: 0 | 1;
  notes_text: string | null;
  ai_config: string | null;
  /** İş anında sabitlenen makale görsel adresleri (JSON dizi). */
  source_images: string;
  request_key: string;
  /** Kullanıcı iptali: failed + cancelled=1 (UI "Hata" değil "İptal edildi" gösterir). */
  cancelled: 0 | 1;
  /** Worker'ın çalışan süreci sonlandırması için istek bayrağı. */
  cancel_requested: 0 | 1;
}

export const DEFAULT_LEASE_MS = 10 * 60 * 1000;

export interface CreateJobInput {
  documentId: number;
  operation: JobOperation;
  summaryLevel?: StoredSummaryLevel;
  sourceKind?: SourceKind;
  sourceText?: string;
  sourceRevision?: number;
  notesIncluded?: boolean;
  notesText?: string | null;
  sourceImages?: string[];
  aiConfig?: AiConfigSnapshot | null;
  /** true ise aynı anahtarlı aktif iş iptal edilip yenisi açılır ("başka AI ile yeniden çalıştır"). */
  forceNew?: boolean;
}

export function newWorkerId(): string {
  return `worker-${randomUUID()}`;
}

export function createJob(db: SqliteDb, input: CreateJobInput): JobRow {
  const level = input.summaryLevel ?? "";
  const requestKey = createRequestKey(input, level);
  const tx = db.transaction((): JobRow => {
    const existing = db
      .prepare(
        `SELECT * FROM jobs
         WHERE request_key = ?
           AND status IN ('pending','processing')
         ORDER BY id LIMIT 1`,
      )
      .get(requestKey) as JobRow | undefined;

    if (existing && !input.forceNew) return existing;

    if (input.forceNew) {
      // "Başka AI ile yeniden çalıştır": bekleyen işi açıkça iptal et, yenisini aç.
      db.prepare(
        `UPDATE jobs SET status = 'failed', error = ?, completed_at = ?, cancelled = 1
         WHERE document_id = ? AND operation = ? AND summary_level = ?
           AND status IN ('pending','processing')`,
      ).run(
        "Kullanıcı tarafından iptal edildi (yeni iş oluşturuldu)",
        nowIso(),
        input.documentId,
        input.operation,
        level,
      );
    }

    const result = db
      .prepare(
        `INSERT INTO jobs
           (document_id, operation, summary_level, status, attempts, created_at,
            source_kind, source_text, source_revision, notes_included, notes_text, ai_config, source_images,
            request_key)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.documentId,
        input.operation,
        level,
        nowIso(),
        input.sourceKind ?? "auto",
        input.sourceText ?? "",
        input.sourceRevision ?? 0,
        input.notesIncluded ? 1 : 0,
        input.notesText ?? null,
        input.aiConfig ? JSON.stringify(input.aiConfig) : null,
        JSON.stringify(input.sourceImages ?? []),
        requestKey,
      );
    return getJob(db, Number(result.lastInsertRowid))!;
  });
  return tx.immediate();
}

function createRequestKey(input: CreateJobInput, level: StoredSummaryLevel): string {
  const payload = JSON.stringify({
    documentId: input.documentId,
    operation: input.operation,
    summaryLevel: level,
    sourceKind: input.sourceKind ?? "auto",
    sourceText: input.sourceText ?? "",
    sourceRevision: input.sourceRevision ?? 0,
    notesIncluded: input.notesIncluded === true,
    notesText: input.notesText ?? null,
    aiConfig: input.aiConfig ?? null,
    sourceImages: input.sourceImages ?? [],
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function getJob(db: SqliteDb, id: number): JobRow | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ?? null;
}

/**
 * Sıradaki pending job'ı atomik olarak claim eder: iş sahipliği (owner) ve
 * lease (kirası) atanır. BEGIN IMMEDIATE sayesinde iki worker aynı işi alamaz.
 */
export function claimNextJob(db: SqliteDb, owner: string, leaseMs = DEFAULT_LEASE_MS): JobRow | null {
  const claim = db.transaction((): JobRow | null => {
    const candidate = db
      .prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at, id LIMIT 1`)
      .get() as JobRow | undefined;
    if (!candidate) return null;
    return claimInTx(db, candidate.id, owner, leaseMs);
  });
  return claim.immediate();
}

/** Belirli bir pending job'ı atomik olarak claim eder (MCP claim_job için). */
export function claimJobById(db: SqliteDb, jobId: number, owner: string, leaseMs = DEFAULT_LEASE_MS): JobRow | null {
  const claim = db.transaction((): JobRow | null => {
    const job = getJob(db, jobId);
    if (!job || job.status !== "pending") return null;
    return claimInTx(db, jobId, owner, leaseMs);
  });
  return claim.immediate();
}

function claimInTx(db: SqliteDb, jobId: number, owner: string, leaseMs: number): JobRow | null {
  const leaseExpiry = new Date(Date.now() + leaseMs).toISOString();
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'processing', started_at = ?, attempts = attempts + 1,
         owner = ?, lease_expires_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(nowIso(), owner, leaseExpiry, jobId);
  if (result.changes === 0) return null;
  return getJob(db, jobId)!;
}

/** İş sahibi, uzun süren çalışma sırasında kirasını yeniler. */
export function renewLease(db: SqliteDb, jobId: number, owner: string, leaseMs = DEFAULT_LEASE_MS): boolean {
  const result = db
    .prepare(
      `UPDATE jobs SET lease_expires_at = ? WHERE id = ? AND owner = ? AND status = 'processing'`,
    )
    .run(new Date(Date.now() + leaseMs).toISOString(), jobId, owner);
  return result.changes > 0;
}

/**
 * Claim edilen iş uygun adapter yoksa attempts sayısını bozmadan kuyruğa geri koyar.
 */
export function releaseJob(db: SqliteDb, jobId: number, owner: string): void {
  db.prepare(
    `UPDATE jobs SET status = 'pending', owner = NULL, lease_expires_at = NULL,
       attempts = MAX(attempts - 1, 0), started_at = NULL
     WHERE id = ? AND owner = ? AND status = 'processing'`,
  ).run(jobId, owner);
}

export interface CompleteJobInput {
  jobId: number;
  owner: string;
  content: string;
  agentName?: string | null;
  agentMetadata?: string | null;
}

export interface CompleteOutcome {
  job: JobRow;
  outputId: number;
  revisionId: number;
}

/**
 * Job'ı tamamlar ve çıktıyı kaydeder. İş sahipliği doğrulanır: lease süresi
 * dolup işi başka sahip aldıysa geç gelen sonuç reddedilir ve mevcut çıktı
 * ezilmez. İptal edilen işin geç gelen çıktısı da kaydedilmez. Aynı anda
 * değişmez bir çıktı revizyonu da kaydedilir.
 */
export function completeJob(db: SqliteDb, input: CompleteJobInput): CompleteOutcome {
  const tx = db.transaction((): CompleteOutcome => {
    const job = getJob(db, input.jobId);
    if (!job) throw new Error(`Job bulunamadı: ${input.jobId}`);
    if (job.status !== "processing") {
      throw new Error(`Job işlenmiyor durumda değil: ${job.status}`);
    }
    if (job.owner !== input.owner) {
      throw new Error("İş sahipliği değişti; geç gelen sonuç kabul edilmedi");
    }
    if (job.cancelled === 1) {
      throw new Error("İş iptal edildi; geç gelen sonuç kabul edilmedi");
    }
    // Chat job'ları document_outputs'a yazılmaz; assistant mesajı chat_messages'a düşer.
    if (job.operation === "chat") {
      let chatContext: { chatMessageId?: number } = {};
      try {
        chatContext = JSON.parse(job.notes_text ?? "{}") as { chatMessageId?: number };
      } catch {
        /* bağlam yok */
      }
      const userMessage = chatContext.chatMessageId
        ? findMessageByJob(db, input.jobId)
        : null;
      if (userMessage) {
        insertAssistantMessage(db, userMessage.conversation_id, job.document_id, input.content);
        setMessageStatus(db, userMessage.id, "completed");
      }
      db.prepare(
        `UPDATE jobs SET status = 'completed', completed_at = ?, error = NULL WHERE id = ?`,
      ).run(nowIso(), job.id);
      return { job: getJob(db, job.id)!, outputId: 0, revisionId: 0 };
    }
    const output = upsertOutput(db, {
      documentId: job.document_id,
      operation: job.operation,
      summaryLevel: job.summary_level,
      content: input.content,
      agentName: input.agentName ?? null,
      agentMetadata: input.agentMetadata ?? null,
    });
    const revisionResult = db
      .prepare(
        `INSERT INTO document_output_revisions
           (output_id, document_id, operation, summary_level, content, agent_name, agent_metadata, job_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        output.id,
        job.document_id,
        job.operation,
        job.summary_level,
        input.content,
        input.agentName ?? null,
        input.agentMetadata ?? null,
        job.id,
        nowIso(),
      );
    db.prepare(
      `UPDATE jobs SET status = 'completed', completed_at = ?, error = NULL WHERE id = ?`,
    ).run(nowIso(), job.id);
    return { job: getJob(db, job.id)!, outputId: output.id, revisionId: Number(revisionResult.lastInsertRowid) };
  });
  return tx.immediate();
}

/** Sahiplik kontrollü başarısız işaretleme (worker/MCP). */
export function failJob(db: SqliteDb, jobId: number, owner: string, error: string): JobRow {
  const tail = error.length > 800 ? `${error.slice(0, 800)}…` : error;
  const tx = db.transaction((): JobRow => {
    const job = getJob(db, jobId);
    if (!job) throw new Error(`Job bulunamadı: ${jobId}`);
    if (job.status !== "processing") throw new Error(`Job işlenmiyor durumda değil: ${job.status}`);
    if (job.owner !== owner) throw new Error("İş sahipliği değişti; hata kaydı kabul edilmedi");
    if (job.operation === "chat") {
      const userMessage = findMessageByJob(db, jobId);
      if (userMessage) setMessageStatus(db, userMessage.id, "failed");
    }
    const result = db.prepare(
      `UPDATE jobs SET status = 'failed', completed_at = ?, error = ?
       WHERE id = ? AND status = 'processing' AND owner = ?`,
    ).run(nowIso(), tail, jobId, owner);
    if (result.changes === 0) throw new Error("İş sahipliği değişti; hata kaydı kabul edilmedi");
    return getJob(db, jobId)!;
  });
  return tx.immediate();
}

export function retryJob(db: SqliteDb, jobId: number): JobRow {
  const tx = db.transaction((): JobRow => {
    const job = getJob(db, jobId);
    if (!job) throw new Error(`Job bulunamadı: ${jobId}`);
    if (job.status !== "failed") throw new Error("Yalnızca başarısız job yeniden denenebilir");
    if (job.attempts >= 5) throw new Error("Bu job için deneme sınırına ulaşıldı");
    // Snapshot alanları (source_text, notes, ai_config) aynen korunur.
    const result = db.prepare(
      `UPDATE jobs SET status = 'pending', error = NULL, started_at = NULL, completed_at = NULL,
         owner = NULL, lease_expires_at = NULL, cancelled = 0, cancel_requested = 0
       WHERE id = ? AND status = 'failed' AND attempts < 5`,
    ).run(jobId);
    if (result.changes === 0) throw new Error("İş durumu değişti; yeniden deneme başlatılamadı");
    if (job.operation === "chat") {
      const userMessage = findMessageByJob(db, jobId);
      if (userMessage) setMessageStatus(db, userMessage.id, "queued");
    }
    return getJob(db, jobId)!;
  });
  return tx.immediate();
}

export type CancelOutcome =
  | { action: "cancelled"; job: JobRow }
  | { action: "abort-requested"; job: JobRow }
  | { action: "already-finished"; job: JobRow };

/**
 * Bağımsız "İptal et":
 * - pending → anında iptal (failed + cancelled=1; UI "Hata" değil "İptal edildi" gösterir)
 * - processing → cancel_requested bayrağı; worker CLI sürecini sonlandırıp finalizeCancel çağırır
 * - sonuçlanmış iş → dokunulmaz
 */
export function cancelJob(db: SqliteDb, jobId: number): CancelOutcome {
  const tx = db.transaction((): CancelOutcome => {
    const job = getJob(db, jobId);
    if (!job) throw new Error(`Job bulunamadı: ${jobId}`);
    if (job.status === "pending") {
      db.prepare(
        `UPDATE jobs SET status = 'failed', cancelled = 1, error = ?, completed_at = ? WHERE id = ? AND status = 'pending'`,
      ).run("İptal edildi", nowIso(), jobId);
      if (job.operation === "chat") {
        const userMessage = findMessageByJob(db, jobId);
        if (userMessage) setMessageStatus(db, userMessage.id, "cancelled");
      }
      return { action: "cancelled", job: getJob(db, jobId)! };
    }
    if (job.status === "processing") {
      db.prepare(`UPDATE jobs SET cancel_requested = 1 WHERE id = ? AND status = 'processing'`).run(jobId);
      return { action: "abort-requested", job: getJob(db, jobId)! };
    }
    return { action: "already-finished", job };
  });
  return tx.immediate();
}

/** Worker, CLI sürecini sonlandırdıktan sonra iptali kesinleştirir (sahiplik kontrollü). */
export function finalizeCancel(db: SqliteDb, jobId: number, owner: string): boolean {
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'failed', cancelled = 1, error = ?, completed_at = ?
       WHERE id = ? AND owner = ? AND status = 'processing'`,
    )
    .run("İptal edildi", nowIso(), jobId, owner);
  return result.changes > 0;
}

export function isCancelRequested(db: SqliteDb, jobId: number): boolean {
  const row = db.prepare(`SELECT cancel_requested FROM jobs WHERE id = ?`).get(jobId) as
    | { cancel_requested: 0 | 1 }
    | undefined;
  return row?.cancel_requested === 1;
}

/**
 * Yalnızca süresi dolmuş lease'lere sahip işleri kuyruğa geri koyar.
 * Açılışta toplu "processing→pending" yapılmaz; ikinci worker/MCP
 * tüketicisinin aktif işini bozmaz.
 */
export function recoverExpiredLeases(db: SqliteDb, leaseGraceMs = 0): number {
  const cutoff = new Date(Date.now() - leaseGraceMs).toISOString();
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'pending', owner = NULL, lease_expires_at = NULL
       WHERE status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
    )
    .run(cutoff);
  return result.changes;
}

export function listJobsByDocument(db: SqliteDb, documentId: number, limit = 10): JobRow[] {
  return db.prepare(`SELECT * FROM jobs WHERE document_id = ? ORDER BY id DESC LIMIT ?`).all(documentId, limit) as JobRow[];
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
  return db.prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at, id LIMIT ?`).all(limit) as JobRow[];
}
