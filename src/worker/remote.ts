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
import { adapterForJobConfig, createProfileAdapter, runProfileValidation } from "../lib/agent/profiles";
import { assertPublicHttpUrl } from "../lib/extraction/fetchArticle";
import { discoverAllCapabilities } from "../lib/agent/capabilities";
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
// Yoklama aralığı: varsayılan 3 sn; READFLOW_POLL_MS ile artırılabilir (ör. 30000 = 30 sn).
const POLL_MS = Math.min(Math.max(Number(process.env.READFLOW_POLL_MS) || 3_000, 1_000), 600_000);

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
        capabilities: discoverAllCapabilities(),
      });

      // Sunucudaki iptal talebi: çalışan süreci sonlandır
      if (currentJobId !== null && heartbeat.cancelRequested === true) {
        currentAdapter?.abort?.();
      }

      // Sunucudan gelen profil doğrulama isteği: kendi CLI'ıyla test et, sonucu bildir
      const validateRequest = heartbeat.validateRequest as
        | { profileId: number; config: { cli: "claude" | "codex" | "jcode"; model: string | null; provider: string | null; effort: string | null; transport: "stdin" | "argv"; timeout_ms: number } }
        | undefined;
      if (validateRequest && !currentJobId) {
        const adapter = createProfileAdapter(validateRequest.config);
        const outcome = await runProfileValidation(adapter, validateRequest.config.timeout_ms ?? 60_000);
        await call("validate-result", {
          validateProfileId: validateRequest.profileId,
          validateOk: outcome.ok,
          validateMessage: outcome.message,
        });
        console.log(`[remote] profil #${validateRequest.profileId} doğrulaması: ${outcome.ok ? "başarılı" : "başarısız"}`);
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
      const fallbackConfigs = Array.isArray(claim.fallbacks)
        ? (claim.fallbacks as AiConfigSnapshot[])
        : [];
      currentJobId = job.id;

      const primary =
        aiConfig?.kind === "profile" && aiConfig.cli
          ? adapterForJobConfig(aiConfig).adapter
          : resolution.adapter;
      if (!primary) {
        console.warn(`[remote] job #${job.id} için adapter kurulamadı`);
        await call("fail", { jobId: job.id, error: "Adapter kurulamadı" });
        currentJobId = null;
        continue;
      }

      // Birincil yapılandırma + sunucudan gelen yedek zinciri (priority sırasında).
      const attempts: Array<{ adapter: AgentAdapter; timeoutMs: number }> = [
        { adapter: primary, timeoutMs: aiConfig?.timeout_ms ?? agentTimeoutMs() },
        ...fallbackConfigs
          .filter((config) => config.cli)
          .map((config) => ({
            adapter: createProfileAdapter({
              cli: config.cli as "claude" | "codex" | "jcode",
              model: config.model ?? null,
              provider: config.provider ?? null,
              effort: config.effort ?? null,
              transport: config.transport,
              timeout_ms: config.timeout_ms,
            }),
            timeoutMs: config.timeout_ms ?? agentTimeoutMs(),
          })),
      ];

      console.log(`[remote] job #${job.id} (${job.operation}) işleniyor…`);
      let lastError = "Bilinmeyen hata";
      let done = false;
      for (const attempt of attempts) {
        currentAdapter = attempt.adapter;
        try {
          const result = await attempt.adapter.run({ prompt, timeoutMs: attempt.timeoutMs });
          await call("complete", {
            jobId: job.id,
            content: result.text,
            agentName: attempt.adapter.name,
          });
          console.log(`[remote] job #${job.id} tamamlandı (${attempt.adapter.name})`);
          done = true;
          break;
        } catch (runError) {
          lastError = runError instanceof Error ? runError.message : String(runError);
          // Kullanıcı iptal ettiyse zinciri sürdürme.
          const cancelHeartbeat = await call("heartbeat", { currentJobId: job.id });
          if (cancelHeartbeat.cancelRequested === true) {
            await call("cancel-ack", { jobId: job.id });
            console.log(`[remote] job #${job.id} iptal edildi`);
            done = true;
            break;
          }
          console.warn(`[remote] ${attempt.adapter.name} başarısız: ${lastError}`);
        }
      }
      if (!done) {
        await call("fail", { jobId: job.id, error: lastError });
        console.error(`[remote] job #${job.id} tüm denemelerde başarısız: ${lastError}`);
      }
      currentJobId = null;
      currentAdapter = null;
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
