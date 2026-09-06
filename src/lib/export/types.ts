import type { DocumentRow } from "../db/repo/documents";
import type { OutputRow } from "../db/repo/outputs";

export interface ExportPayload {
  document: DocumentRow;
  output: OutputRow | null;
}

export interface RemoteExportResult {
  ok: boolean;
  message: string;
  url?: string;
}

export interface RemoteExporter {
  readonly id: "notion" | "telegram";
  isConfigured(): boolean;
  missingConfig(): string[];
  export(payload: ExportPayload): Promise<RemoteExportResult>;
}
