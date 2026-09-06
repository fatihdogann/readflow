import type { DocumentRow } from "../db/repo/documents";
import type { OutputRow } from "../db/repo/outputs";

export interface ExportPayload {
  document: DocumentRow;
  output: OutputRow | null;
  /** Düzenlenmiş varyant dışa aktarımında kullanıcının sürüm içeriği. */
  editedContent?: string;
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
