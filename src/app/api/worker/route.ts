import { createHash } from "node:crypto";
import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import {
  claimNextJob,
  completeJob,
  failJob,
  finalizeCancel,
  getJob,
  isCancelRequested,
  renewLease,
  type AiConfigSnapshot,
} from "@/lib/db/repo/jobs";
import { getDocument } from "@/lib/db/repo/documents";
import { buildPromptForSnapshot } from "@/lib/ai/instructions";
import { readHeartbeat, writeHeartbeat, HEARTBEAT_KEY } from "@/lib/jobs/worker";
import { buildChatPromptForJob } from "@/lib/jobs/chat-context";
import { getMeta, setMeta } from "@/lib/db/repo/meta";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Mac worker'ın merkezi kuyruğa eriştiği tek uç. Yalnızca
 * WORKER_ENROLLMENT_SECRET ile yetkilidir; web oturumu/Telegram secret'larından ayrıdır.
 */

function authorized(request: Request): boolean {
  const expected = process.env.WORKER_ENROLLMENT_SECRET?.trim();
  if (!expected) return false; // secret tanımlı değilse worker erişimi kapalı
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return a.equals(b);
}

const schema = z.object({
  action: z.enum(["claim", "heartbeat", "complete", "fail", "cancel-ack", "validate-result"]),
  workerId: z.string().min(3).max(80),
  currentJobId: z.number().int().positive().nullable().optional(),
  agentName: z.string().max(100).nullable().optional(),
  agentMode: z.enum(["command", "mock", "none"]).nullable().optional(),
  jobId: z.number().int().positive().optional(),
  content: z.string().min(1).optional(),
  error: z.string().max(2000).optional(),
  validateProfileId: z.number().int().positive().optional(),
  validateOk: z.boolean().optional(),
  validateMessage: z.string().max(400).optional(),
  capabilities: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
});

const LEASE_MS = 10 * 60 * 1000;

function ensureSnapshotText(documentId: number, existing: string): string {
  if (existing.trim()) return existing;
  const doc = getDocument(getDb(), documentId);
  return doc?.original_text ?? "";
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!authorized(request)) {
      return Response.json({ error: "Yetkisiz worker isteği" }, { status: 401 });
    }
    const body = schema.parse(await readJsonBody(request));
    const db = getDb();
    const now = new Date().toISOString();

    if (body.action === "heartbeat") {
      const existing = readHeartbeat(db);
      writeHeartbeat(db, {
        ts: now,
        agentMode: body.agentMode ?? existing?.agentMode ?? "none",
        agentName: body.agentName ?? existing?.agentName ?? null,
        workerId: body.workerId,
        message: "remote worker",
        lastError: existing?.lastError,
      });
      if (body.currentJobId) renewLease(db, body.currentJobId, body.workerId, LEASE_MS);
      // Mac'te tespit edilen CLI yeteneklerini sakla (Ayarlar ekranı bunları gösterir)
      if (body.capabilities) {
        setMeta(db, "worker_capabilities", JSON.stringify(body.capabilities));
      }
      const cancelRequested = body.currentJobId ? isCancelRequested(db, body.currentJobId) : false;
      const pending = db
        .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status='pending'`)
        .get() as { c: number };
      // Bekleyen profil doğrulama isteği varsa worker'a bildir
      const validateRaw = getMeta(db, "profile_validate_request");
      let validateRequest: { profileId: number; config: Record<string, unknown> } | null = null;
      if (validateRaw) {
        try {
          const parsed = JSON.parse(validateRaw) as { profileId: number };
          const profileRow = db
            .prepare(`SELECT id, cli, model, provider, transport, timeout_ms FROM agent_profiles WHERE id = ?`)
            .get(parsed.profileId) as Record<string, unknown> | undefined;
          if (profileRow) {
            validateRequest = { profileId: parsed.profileId, config: profileRow };
          } else {
            setMeta(db, "profile_validate_request", "");
          }
        } catch {
          setMeta(db, "profile_validate_request", "");
        }
      }
      return Response.json({
        ok: true,
        cancelRequested,
        pending: pending.c,
        validateRequest,
      });
    }

    if (body.action === "validate-result") {
      // Mac worker doğrulamayı çalıştırdı: sonucu profile yaz, isteği temizle
      if (!body.validateProfileId) throw new InputError("validateProfileId gerekli");
      const ok = body.validateOk === true;
      db.prepare(
        `UPDATE agent_profiles SET last_validated_at = ?, last_validation_ok = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      ).run(now, ok ? 1 : 0, ok ? null : (body.validateMessage ?? "").slice(0, 400), now, body.validateProfileId);
      setMeta(db, "profile_validate_request", "");
      return Response.json({ ok: true });
    }

    if (body.action === "claim") {
      const job = claimNextJob(db, body.workerId, LEASE_MS);
      if (!job) return Response.json({ job: null });
      const sourceText = ensureSnapshotText(job.document_id, job.source_text);
      let images: string[] = [];
      try {
        const parsed = JSON.parse(job.source_images) as unknown;
        images = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
      } catch {
        images = [];
      }
      const prompt =
        job.operation === "chat"
          ? buildChatPromptForJob(db, job)
          : buildPromptForSnapshot({
              operation: job.operation,
              summaryLevel: job.summary_level,
              sourceText,
              notesIncluded: job.notes_included === 1,
              notesText: job.notes_text,
              images,
            });
      let aiConfig: AiConfigSnapshot | null = null;
      try {
        aiConfig = job.ai_config ? (JSON.parse(job.ai_config) as AiConfigSnapshot) : null;
      } catch {
        aiConfig = null;
      }
      return Response.json({
        job: {
          id: job.id,
          operation: job.operation,
          summaryLevel: job.summary_level,
        },
        aiConfig,
        prompt,
      });
    }

    if (body.action === "complete") {
      if (!body.jobId || !body.content) throw new InputError("jobId ve content gerekli");
      const aiConfigText = getJob(db, body.jobId)?.ai_config ?? null;
      let aiName = "agent";
      try {
        if (aiConfigText) aiName = (JSON.parse(aiConfigText) as { cli?: string }).cli ?? aiName;
      } catch {
        /* varsayılan */
      }
      const result = completeJob(db, {
        jobId: body.jobId,
        owner: body.workerId,
        content: body.content,
        agentName: body.agentName ?? aiName,
      });
      return Response.json({ ok: true, outputId: result.outputId, revisionId: result.revisionId });
    }

    if (body.action === "fail") {
      if (!body.jobId) throw new InputError("jobId gerekli");
      const job = failJob(db, body.jobId, body.workerId, body.error ?? "Bilinmeyen hata");
      return Response.json({ ok: true, job });
    }

    // cancel-ack: worker süreci sonlandırdığını bildirir
    if (!body.jobId) throw new InputError("jobId gerekli");
    const finalized = finalizeCancel(db, body.jobId, body.workerId);
    return Response.json({ ok: finalized });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(): Promise<Response> {
  // Sağlık kontrolü: secret var mı (değeri sızdırmadan)
  void getDb;
  void setMeta;
  void HEARTBEAT_KEY;
  return Response.json({
    ok: true,
    enrollmentConfigured: Boolean(process.env.WORKER_ENROLLMENT_SECRET?.trim()),
  });
}
