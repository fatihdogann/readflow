import type { Operation, StoredSummaryLevel } from "../../types";
import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export interface OutputRow {
  id: number;
  document_id: number;
  operation: Operation;
  summary_level: StoredSummaryLevel;
  content: string;
  agent_name: string | null;
  agent_metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertOutputInput {
  documentId: number;
  operation: Operation;
  summaryLevel: StoredSummaryLevel;
  content: string;
  agentName?: string | null;
  agentMetadata?: string | null;
}

export function upsertOutput(db: SqliteDb, input: UpsertOutputInput): OutputRow {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO document_outputs
       (document_id, operation, summary_level, content, agent_name, agent_metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id, operation, summary_level) DO UPDATE SET
       content = excluded.content,
       agent_name = excluded.agent_name,
       agent_metadata = excluded.agent_metadata,
       updated_at = excluded.updated_at`,
  ).run(
    input.documentId,
    input.operation,
    input.summaryLevel,
    input.content,
    input.agentName ?? null,
    input.agentMetadata ?? null,
    ts,
    ts,
  );
  const row = db
    .prepare(
      `SELECT * FROM document_outputs WHERE document_id = ? AND operation = ? AND summary_level = ?`,
    )
    .get(input.documentId, input.operation, input.summaryLevel) as OutputRow | undefined;
  return row!;
}

export function listOutputs(db: SqliteDb, documentId: number): OutputRow[] {
  return db
    .prepare(`SELECT * FROM document_outputs WHERE document_id = ? ORDER BY id`)
    .all(documentId) as OutputRow[];
}

export function getOutput(db: SqliteDb, outputId: number): OutputRow | null {
  const row = db.prepare(`SELECT * FROM document_outputs WHERE id = ?`).get(outputId) as
    | OutputRow
    | undefined;
  return row ?? null;
}

/** Geçmiş listesindeki rozetler için: doküman -> üretilmiş çıktı özeti. */
export function listOutputSummariesForDocuments(
  db: SqliteDb,
  documentIds: number[],
): Map<number, Array<{ operation: Operation; summary_level: StoredSummaryLevel }>> {
  const map = new Map<number, Array<{ operation: Operation; summary_level: StoredSummaryLevel }>>();
  if (documentIds.length === 0) return map;
  const placeholders = documentIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT document_id, operation, summary_level FROM document_outputs
       WHERE document_id IN (${placeholders}) ORDER BY id`,
    )
    .all(...documentIds) as Array<{
    document_id: number;
    operation: Operation;
    summary_level: StoredSummaryLevel;
  }>;
  for (const row of rows) {
    const list = map.get(row.document_id) ?? [];
    list.push({ operation: row.operation, summary_level: row.summary_level });
    map.set(row.document_id, list);
  }
  return map;
}

export interface OutputRevisionRow {
  id: number;
  output_id: number;
  document_id: number;
  operation: Operation;
  summary_level: StoredSummaryLevel;
  content: string;
  agent_name: string | null;
  agent_metadata: string | null;
  job_id: number | null;
  created_at: string;
}

/** Bir çıktının değişmez revizyonları (en yeni önce). */
export function listOutputRevisions(db: SqliteDb, outputId: number): OutputRevisionRow[] {
  return db
    .prepare(`SELECT * FROM document_output_revisions WHERE output_id = ? ORDER BY id DESC`)
    .all(outputId) as OutputRevisionRow[];
}

export function getOutputRevision(db: SqliteDb, revisionId: number): OutputRevisionRow | null {
  const row = db.prepare(`SELECT * FROM document_output_revisions WHERE id = ?`).get(revisionId) as
    | OutputRevisionRow
    | undefined;
  return row ?? null;
}

/** Filtre seçenekleri için kullanılan agent adları (provenance). */
export function listDistinctAgentNames(db: SqliteDb): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT agent_name AS name FROM document_outputs
       WHERE agent_name IS NOT NULL AND agent_name != '' ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}
