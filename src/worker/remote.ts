/**
 * Remote worker: Coolify'daki merkezi kuyruğa outbound HTTPS ile bağlanır.
 * Sunucudan yalnızca prompt + AI yapılandırması (cli/model/provider/transport)
 * alır; argv Mac tarafında, kurulu CLI'ın --help'iyle doğrulanmış preset'lerden
 * üretilir. Çalıştırma: pnpm worker:remote
 *
 * Gerekli ortam değişkenleri (.env.local veya launchd):
 *   READFLOW_SERVER_URL=https://<domain>
 *   READFLOW_WORKER_TOKEN=<WORKER_ENROLLMENT_SECRET ile aynı değer>
 *   READFLOW_AGENT_CMD / READFLOW_AGENT_MODE (opsiyonel, Mac tarafı zorlaması)
 * Yerel test için: READFLOW_WORKER_ALLOW_PRIVATE=1 (http/localhost hedefe izin verir)
 */
import { loadLocalEnv } from "../lib/env";
import { resolveAdapter, agentTimeoutMs, type AgentAdapter, type AgentRuntimeInfo } from "../lib/agent";
import { adapterForJobConfig } from "../lib/agent/profiles";
import { assertPublicHttpUrl } from "../lib/extraction/fetchArticle";
import type { AiConfigSnapshot } from "../lib/db/repo/jobs";

loadLocalEnv();

const allowPrivate = process.env.READFLOW_WORKER_ALLOW_PRIVATE === "1";
const rawServer = (process.env.READFLOW_SERVER_URL ?? "").replace(/\/$/, "");
if (!rawServer) {
  console.error("[remote] READFLOW_SERVER_URL gerekli");
  process.exit(1);
}
if (!allowPrivate) {
  // Varsayılan: yalnızca genel https hedefe izin ver (SSRF yüzeyini kapatır)
  assertPublicHttpUrl(rawServer);
}
const parsedServer = new URL(rawServer);
if (parsedServer.protocol !== "https:" && parsedServer.protocol !== "http:") {
  console.error("[remote] READFLOW_SERVER_URL yalnızca http/https olabilir");
  process.exit(1);
}
const SERVER = rawServer;
const TOKEN = process.env.READFLOW_WORKER_TOKEN ?? "";
const WORKER_ID = `remote-${process.env.USER ?? "mac"}-${Date.now().toString(36)}`;
const POLL_MS = 3_000;

if (!TOKEN) {
  console.error("[remote] READFLOW_WORKER_TOKEN gerekli");
  process.exit(1);
}

let currentJobId: number | null = null;
let currentAdapter: AgentAdapter | null = null;
let stopped = false;

process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});

async function call(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${SERVER}/api/worker`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ action, workerId: WORKER_ID, currentJobId, ...extra }),
  });
  if (response.status === 401) {
    throw new Error("Yetkisiz — READFLOW_WORKER_TOKEN, sunucudaki WORKER_ENROLLMENT_SECRET ile eşleşmiyor");
  }
  if (!response.ok) throw new Error(`Sunucu hatası (HTTP ${response.status})`);
  return (await response.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  console.log(`[remote] ${WORKER_ID} → ${SERVER}`);

  // Mac tarafındaki agent bağlantısı (env CMD veya yerel tespit)
  const resolution = resolveAdapter();
  const info: AgentRuntimeInfo = resolution.info;
  if (resolution.adapter) {
    console.log(`[remote] Agent bağlı: ${resolution.adapter.name}${info.command ? ` (${info.command})` : ""}`);
  } else {
    console.warn(`[remote] Agent bağlı değil: ${info.message ?? ""}`);
  }

  while (!stopped) {
    try {
      const heartbeat = await call("heartbeat", {
        agentName: resolution.adapter?.name ?? null,
        agentMode: resolution.info.mode,
      });

      // Sunucudaki iptal talebi: çalışan süreci sonlandır
      if (currentJobId !== null && heartbeat.cancelRequested === true) {
        currentAdapter?.abort?.();
      }

      if (!resolution.adapter) {
        await sleep(POLL_MS * 5);
        continue;
      }

      if (heartbeat.pending === 0) {
        await sleep(POLL_MS);
        continue;
      }

      const claim = await call("claim");
      const job = claim.job as { id: number; operation: string; summaryLevel: string } | null;
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }

      const prompt = String(claim.prompt ?? "");
      const aiConfig = (claim.aiConfig ?? null) as AiConfigSnapshot | null;
      currentJobId = job.id;
      currentAdapter =
        aiConfig?.kind === "profile" && aiConfig.cli
          ? adapterForJobConfig(aiConfig).adapter
          : resolution.adapter;

      if (!currentAdapter) {
        console.warn(`[remote] job #${job.id} için adapter kurulamadı`);
        await call("fail", { jobId: job.id, error: "Adapter kurulamadı" });
        currentJobId = null;
        continue;
      }

      console.log(`[remote] job #${job.id} (${job.operation}) işleniyor…`);
      const timeout = aiConfig?.timeout_ms ?? agentTimeoutMs();
      try {
        const result = await currentAdapter.run({ prompt, timeoutMs: timeout });
        await call("complete", {
          jobId: job.id,
          content: result.text,
          agentName: currentAdapter.name,
        });
        console.log(`[remote] job #${job.id} tamamlandı`);
      } catch (runError) {
        const message = runError instanceof Error ? runError.message : String(runError);
        const cancelHeartbeat = await call("heartbeat", { currentJobId: job.id });
        if (cancelHeartbeat.cancelRequested === true) {
          await call("cancel-ack", { jobId: job.id });
          console.log(`[remote] job #${job.id} iptal edildi`);
        } else {
          await call("fail", { jobId: job.id, error: message });
          console.error(`[remote] job #${job.id} başarısız: ${message}`);
        }
      } finally {
        currentJobId = null;
        currentAdapter = null;
      }
    } catch (loopError) {
      console.error(`[remote] ${loopError instanceof Error ? loopError.message : loopError}`);
      await sleep(5_000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("[remote] ölümcül hata:", error);
  process.exit(1);
});
