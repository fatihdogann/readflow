/**
 * Readflow yerel MCP sunucusu.
 * Stdio üzerinden konuşur; coding agent'lar Readflow job kuyruğuna ve
 * dokümanlarına doğrudan erişebilir. Web uygulamasının parçası değildir;
 * yalnızca adapter/tool katmanıdır.
 *
 * Çalıştırma: pnpm dev:mcp  (veya agent konfigürasyonunda: tsx <repo>/src/mcp/server.ts)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDatabase } from "../lib/db/connection";
import {
  claimJobById,
  claimNextJob,
  completeJob,
  failJob,
  getJob,
  listPendingJobs,
} from "../lib/db/repo/jobs";
import { getDocument, listDocuments } from "../lib/db/repo/documents";
import { listOutputs } from "../lib/db/repo/outputs";
import { listDocumentTags } from "../lib/db/repo/tags";
import { createDocumentFromInput } from "../lib/documents/service";
import { buildPromptForJob } from "../lib/ai/instructions";

const db = openDatabase();

const server = new McpServer({
  name: "readflow",
  version: "0.1.0",
});

function textResult(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…kısaltıldı]` : text;
}

server.registerTool(
  "readflow_list_pending_jobs",
  {
    title: "Bekleyen job'ları listele",
    description: "Readflow kuyruğundaki pending durumdaki AI job'larını listeler.",
    inputSchema: {},
  },
  async () => textResult({ jobs: listPendingJobs(db, 50) }),
);

server.registerTool(
  "readflow_get_job",
  {
    title: "Job detayı",
    description: "Bir job'ın durumunu, deneme sayısını ve hata bilgisini döndürür.",
    inputSchema: { jobId: z.number().int().positive() },
  },
  async ({ jobId }) => {
    const job = getJob(db, jobId);
    if (!job) return textResult({ error: `Job bulunamadı: ${jobId}` });
    return textResult({ job });
  },
);

server.registerTool(
  "readflow_claim_job",
  {
    title: "Job al",
    description:
      "Sıradaki pending job'ı (veya jobId verilirse belirli job'ı) processing durumuna alır. Atomiktir; aynı job iki kez dağıtılamaz.",
    inputSchema: { jobId: z.number().int().positive().optional() },
  },
  async ({ jobId }) => {
    const job = jobId ? claimJobById(db, jobId) : claimNextJob(db);
    if (!job) {
      return textResult({ job: null, message: "Uygun pending job yok." });
    }
    const document = getDocument(db, job.document_id);
    const prompt = document
      ? buildPromptForJob(job.operation, job.summary_level, document.original_text)
      : null;
    return textResult({
      job,
      documentTitle: document?.title ?? null,
      prompt,
    });
  },
);

server.registerTool(
  "readflow_complete_job",
  {
    title: "Job'ı tamamla",
    description:
      "Claim edilmiş bir job'ı tamamlandı işaretler ve ürettiğin içeriği document_output olarak kaydeder. İçerik Markdown olmalıdır.",
    inputSchema: {
      jobId: z.number().int().positive(),
      content: z.string().min(1),
      agentName: z.string().max(100).optional(),
    },
  },
  async ({ jobId, content, agentName }) => {
    try {
      const { job, outputId } = completeJob(db, {
        jobId,
        content,
        agentName: agentName ?? "mcp-agent",
      });
      return textResult({ ok: true, jobId: job.id, outputId });
    } catch (error) {
      return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);

server.registerTool(
  "readflow_fail_job",
  {
    title: "Job'ı başarısız işaretle",
    description: "Claim edilmiş bir job'ı hata bilgisiyle başarısız duruma alır.",
    inputSchema: {
      jobId: z.number().int().positive(),
      error: z.string().min(1).max(2000),
    },
  },
  async ({ jobId, error }) => {
    const job = failJob(db, jobId, error);
    return textResult({ ok: true, job });
  },
);

server.registerTool(
  "readflow_get_document",
  {
    title: "Dokümanı getir",
    description: "Dokümanı, tüm AI çıktılarını ve etiketlerini döndürür.",
    inputSchema: { documentId: z.number().int().positive() },
  },
  async ({ documentId }) => {
    const document = getDocument(db, documentId);
    if (!document) return textResult({ error: `Doküman bulunamadı: ${documentId}` });
    const trimmed = {
      ...document,
      original_text: truncate(document.original_text, 50_000),
      original_html: document.original_html ? truncate(document.original_html, 50_000) : null,
    };
    return textResult({
      document: trimmed,
      outputs: listOutputs(db, documentId),
      tags: listDocumentTags(db, documentId),
    });
  },
);

server.registerTool(
  "readflow_create_document",
  {
    title: "Doküman oluştur",
    description:
      "Yeni doküman ekler. url verilirse sayfa sunucu tarafında indirilip ayrıştırılır; text verilirse doğrudan kaydedilir. AI kullanılmaz.",
    inputSchema: {
      url: z.string().url().optional(),
      text: z.string().min(1).optional(),
      title: z.string().max(300).optional(),
    },
  },
  async ({ url, text, title }) => {
    try {
      const document = await createDocumentFromInput(db, { url, text, title });
      return textResult({ ok: true, id: document.id, title: document.title });
    } catch (error) {
      return textResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

server.registerTool(
  "readflow_list_documents",
  {
    title: "Dokümanları listele",
    description: "Arşivdeki son dokümanları listeler.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  },
  async ({ limit }) => {
    const docs = listDocuments(db, { limit: limit ?? 20 }).map((d) => ({
      id: d.id,
      title: d.title,
      source_type: d.source_type,
      source_domain: d.source_domain,
      created_at: d.created_at,
    }));
    return textResult({ documents: docs });
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[readflow-mcp] Stdio MCP sunucusu hazır");
}

main().catch((error) => {
  console.error("[readflow-mcp] başlatılamadı:", error);
  process.exit(1);
});
