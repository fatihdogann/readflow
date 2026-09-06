import type { SqliteDb } from "../db/connection";
import { getDocument, type DocumentRow } from "../db/repo/documents";
import { getEdit } from "../db/repo/documentEdits";
import {
  createJob,
  type AiConfigSnapshot,
  type JobRow,
  type SourceKind,
} from "../db/repo/jobs";
import { getDefaultProfileId, getProfile } from "../db/repo/agentProfiles";
import { getEnvironmentLock, profileToSnapshot } from "../agent/profiles";
import { extractImageUrls } from "../extraction/fetchArticle";
import { InputError, operationSchema, summaryLevelSchema, type StoredSummaryLevel } from "../types";
import { z } from "zod";

export interface JobCreateRequest {
  documentId: number;
  operation: string;
  summaryLevel?: string;
  sourceKind?: "auto" | "original" | "edited";
  includeNotes?: boolean;
  aiProfileId?: number | null;
  forceNew?: boolean;
}

export const jobCreateSchema = z
  .object({
    documentId: z.number().int().positive(),
    operation: operationSchema,
    summaryLevel: summaryLevelSchema.optional(),
    sourceKind: z.enum(["auto", "original", "edited"]).optional(),
    includeNotes: z.boolean().optional(),
    aiProfileId: z.number().int().positive().nullable().optional(),
    forceNew: z.boolean().optional(),
  })
  .refine((body) => body.operation !== "summary" || body.summaryLevel !== undefined, {
    message: "Özet operasyonu için seviye gerekli",
  });

/**
 * İş oluşturma anında AI yapılandırması, kaynak metin ve notlar sabitlenir
 * (snapshot). Sonraki ayar/metin değişiklikleri bekleyen işi etkilemez;
 * retry aynı snapshot ile çalışır.
 */
export function createJobWithSnapshot(db: SqliteDb, request: JobCreateRequest): JobRow {
  const operation = operationSchema.parse(request.operation);
  const level: StoredSummaryLevel = request.summaryLevel
    ? summaryLevelSchema.parse(request.summaryLevel)
    : "";

  const doc: DocumentRow | null = getDocument(db, request.documentId);
  if (!doc) throw new InputError("Doküman bulunamadı");
  const edit = getEdit(db, request.documentId);

  const requested: SourceKind = request.sourceKind ?? "auto";
  let sourceKind: "original" | "edited";
  let sourceText: string;
  let sourceRevision: number;
  if (requested === "edited" || (requested === "auto" && edit)) {
    if (!edit) throw new InputError("Düzenlenmiş sürüm yok — kaynak olarak Orijinal seçin");
    sourceKind = "edited";
    sourceText = edit.content;
    sourceRevision = edit.revision;
  } else {
    sourceKind = "original";
    sourceText = doc.original_text;
    sourceRevision = 0;
  }
  if (!sourceText.trim()) throw new InputError("Seçilen kaynak boş");

  const notesIncluded = request.includeNotes === true && doc.note.trim().length > 0;
  const notesText = notesIncluded ? doc.note : null;

  // URL kaynaklı dokümanlarda makale görselleri iş anında snapshot'a girer;
  // AI yalnızca bu adresleri Markdown görseli olarak kullanabilir.
  const sourceImages = extractImageUrls(doc.original_html);

  const aiConfig = resolveAiConfig(db, request.aiProfileId ?? null);

  return createJob(db, {
    documentId: doc.id,
    operation,
    summaryLevel: level,
    sourceKind,
    sourceText,
    sourceRevision,
    notesIncluded,
    notesText,
    sourceImages,
    aiConfig,
    forceNew: request.forceNew === true,
  });
}

/**
 * Öncelik: env kilidi > açık profil > kaydedilmiş varsayılan > otomatik tespit.
 * Snapshot sonraki env değişikliklerinden etkilenmez.
 */
export function resolveAiConfig(
  db: SqliteDb,
  explicitProfileId: number | null,
): AiConfigSnapshot {
  const lock = getEnvironmentLock();
  if (lock.locked) return { kind: "env" };

  const candidateIds = [explicitProfileId, getDefaultProfileId(db)];
  for (const id of candidateIds) {
    if (!id) continue;
    const profile = getProfile(db, id);
    if (!profile || !profile.enabled) continue;
    return profileToSnapshot(profile);
  }
  return { kind: "auto" };
}

/** Bekleyen işin "neden beklediğini" UI'a anlamlı anlatmak için. */
export function jobWaitReason(db: SqliteDb, job: JobRow): string | null {
  if (job.status !== "pending") return null;
  const config = safeParseConfig(job.ai_config);
  if (!config || config.kind === "auto" || config.kind === "env") {
    const lock = getEnvironmentLock();
    if (lock.locked && lock.reason === "mode" && lock.description.includes("none")) {
      return "Agent bağlantısı devre dışı (READFLOW_AGENT_MODE=none)";
    }
    return "Agent bağlı değil — bağlanınca işlenir";
  }
  const profile = getProfile(db, config.profile_id ?? 0);
  if (!profile) return "Profil silinmiş; iş kendi kayıtlı yapılandırmasıyla çalışır";
  return null;
}

export function safeParseConfig(raw: string | null): AiConfigSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AiConfigSnapshot;
  } catch {
    return null;
  }
}
