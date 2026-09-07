import { CommandAgentAdapter } from "./command";
import {
  getCachedCapabilities,
  type CliCapabilities,
  type SupportedCli,
} from "./capabilities";
import { resolveAdapter, type AgentAdapter, type AgentRuntimeInfo } from "./index";
import type { AiConfigSnapshot } from "../db/repo/jobs";
import type { AgentProfileRow } from "../db/repo/agentProfiles";

export interface EnvironmentLock {
  locked: boolean;
  reason: "mode" | "cmd" | null;
  description: string;
}

/**
 * READFLOW_AGENT_MODE / READFLOW_AGENT_CMD ile açıkça zorlanan yapılandırma
 * varsa UI kilidi değiştiremez: "Environment tarafından yönetiliyor" gösterilir.
 */
export function getEnvironmentLock(): EnvironmentLock {
  const mode = (process.env.READFLOW_AGENT_MODE ?? "auto").trim().toLowerCase();
  const cmd = process.env.READFLOW_AGENT_CMD?.trim();
  if (cmd) {
    return { locked: true, reason: "cmd", description: "READFLOW_AGENT_CMD ile özel komut bağlı" };
  }
  if (mode === "mock") return { locked: true, reason: "mode", description: "READFLOW_AGENT_MODE=mock (geliştirme/test)" };
  if (mode === "none") return { locked: true, reason: "mode", description: "READFLOW_AGENT_MODE=none (devre dışı)" };
  if (mode === "command") return { locked: true, reason: "mode", description: "READFLOW_AGENT_MODE=command" };
  return { locked: false, reason: null, description: "Otomatik / profil seçimi aktif" };
}

/** Reasoning effort için kabul edilen değerler (claude --help'te doğrulanan liste). */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Yetenek kaynağı: Mac worker'ın raporladığı `--help` çıkarımı önceliklidir.
 * Coolify container'ında CLI kurulu olmadığı için sunucu tespiti boş döner ve
 * doğrulanmış bayraklar yanlışlıkla düşer — profil oluşturma/güncelleme bu
 * fonksiyondan geçmeli.
 */
export function effectiveCapabilities(
  workerCapabilitiesJson: string | null,
  cli: SupportedCli,
): CliCapabilities {
  if (workerCapabilitiesJson) {
    try {
      const all = JSON.parse(workerCapabilitiesJson) as CliCapabilities[];
      const match = all.find((candidate) => candidate.cli === cli);
      if (match) return match;
    } catch {
      /* bozuk kayıt: sunucu tespitine düş */
    }
  }
  return getCachedCapabilities(cli);
}

/** Profil → doğrulanmış preset argv (shellsiz spawn). Bayrak yalnızca help'te doğrulanmışsa eklenir. */
export function buildCommandForProfile(input: {
  cli: SupportedCli;
  model?: string | null;
  provider?: string | null;
  effort?: string | null;
}, caps: CliCapabilities): string {
  return buildArgvForProfile(input, caps).join(" ");
}

/**
 * argv dizisi üretir: model/provider değerleri tek token olarak korunur
 * (shellsiz spawn'da boşluklu değer güvenlidir, ancak model kimliği
 * katalogda doğrulanmış olmalıdır).
 */
export function buildArgvForProfile(input: {
  cli: SupportedCli;
  model?: string | null;
  provider?: string | null;
  effort?: string | null;
}, caps: CliCapabilities): string[] {
  // Effort yalnızca doğrulanmış değerlerden biriyse taşınır; uydurma seviye geçmez.
  const effort = isEffortLevel(input.effort) ? input.effort : null;

  if (input.cli === "claude") {
    const argv = ["claude", "-p"];
    if (input.model && caps.modelFlag) argv.push("--model", input.model.trim().slice(0, 160));
    if (effort && caps.effortFlag) argv.push("--effort", effort);
    return argv;
  }
  if (input.cli === "codex") {
    const argv = ["codex", "exec"];
    if (caps.sandboxReadonlyFlag) argv.push("--sandbox", "read-only");
    if (input.model && caps.modelFlag) argv.push("-m", input.model.trim().slice(0, 160));
    // codex'te --effort yok; değer TOML string olarak config override ile verilir.
    if (effort && caps.configOverrideFlag) argv.push("-c", `model_reasoning_effort="${effort}"`);
    argv.push("-");
    return argv;
  }
  // jcode: mesaj konumsal argüman olarak zorunlu (transport argv).
  // jcode run'da effort bayrağı yok — profildeki değer bilinçli olarak yok sayılır.
  const argv = ["jcode", "run"];
  if (caps.jsonFlag) argv.push("--json");
  if (input.provider && caps.providerFlag) argv.push("--provider", input.provider.trim().slice(0, 120));
  if (input.model && caps.modelFlag) argv.push("--model", input.model.trim().slice(0, 160));
  return argv;
}

/**
 * jcode --json çıktısından yalnızca nihai mesaj metnini çıkarır; düşünme
 * (reasoning) akışı ve [Tokens] metadata satırı böylece çıktıya bulaşmaz.
 * JSON çözülemezse düz metne döner (fallback).
 */
export function parseJcodeJsonOutput(raw: string): string {
  const start = raw.indexOf("{");
  if (start === -1) return stripTrailingTokenLine(raw);
  try {
    const parsed = JSON.parse(raw.slice(start)) as { text?: unknown };
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      return parsed.text.trim();
    }
  } catch {
    /* düz metne düş */
  }
  return stripTrailingTokenLine(raw);
}

/**
 * Profilin transport'u ile CLI yeteneğini birleştirir: CLI prompt'u argüman
 * olarak zorunlu kılıyorsa (jcode) transport ne derse desin argv olur.
 */
export function resolveTransport(
  caps: CliCapabilities,
  preferred: "stdin" | "argv" | undefined,
): "stdin" | "argv" {
  if (caps.argvRequired) return "argv";
  return preferred === "argv" ? "argv" : "stdin";
}

/**
 * jcode, başarılı yanıtın sonuna stdout üzerinden "[Tokens] upload: …" metadata
 * satırı ekler (gözlem). Yalnızca SON satır bu desense kırpılır; içerik içinde
 * geçen satırlara dokunulmaz.
 */
export function stripTrailingTokenLine(text: string): string {
  const lines = text.split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (/^\[Tokens\]\s/.test(last)) {
    lines.pop();
    return lines.join("\n").trimEnd();
  }
  return text;
}

/** Doğrulanmış profil alanlarından adapter üretir (worker/job snapshot yolu). */
export function createProfileAdapter(config: {
  cli: SupportedCli;
  model?: string | null;
  provider?: string | null;
  effort?: string | null;
  transport?: "stdin" | "argv";
  timeout_ms?: number;
}): AgentAdapter {
  const caps = getCachedCapabilities(config.cli);
  const argv = buildArgvForProfile(config, caps);
  return new CommandAgentAdapter(argv.join(" "), {
    promptVia: resolveTransport(caps, config.transport),
    label: config.cli,
    argv,
    postProcess: config.cli === "jcode" ? parseJcodeJsonOutput : undefined,
  });
}

/** Ayarlar ekranındaki "Bağlantıyı doğrula" için örnek test çağrısı. */
export const VALIDATION_TEST_PROMPT = "Bu bir bağlantı testidir. Yalnızca şu kelimeyi yaz: TAMAM";

export interface ValidationOutcome {
  ok: boolean;
  message: string;
  durationMs: number;
}

/** Profilin gerçekten çalışıp çalışmadığını örnek metinle test eder (adapter varsa). */
export async function runProfileValidation(
  adapter: AgentAdapter,
  timeoutMs: number,
): Promise<ValidationOutcome> {
  const startedAt = Date.now();
  try {
    const result = await adapter.run({ prompt: VALIDATION_TEST_PROMPT, timeoutMs: Math.min(timeoutMs, 90_000) });
    const durationMs = Date.now() - startedAt;
    const ok = /TAMAM/.test(result.text);
    return {
      ok,
      durationMs,
      message: ok
        ? `Doğrulandı (${(durationMs / 1000).toFixed(1)} sn içinde TAMAM yanıtı)`
        : `CLI yanıt verdi ancak beklenen test yanıtı alınamadı: ${result.text.slice(0, 120)}`,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function profileToSnapshot(profile: AgentProfileRow): AiConfigSnapshot {
  return {
    kind: "profile",
    profile_id: profile.id,
    name: profile.name,
    cli: profile.cli,
    model: profile.model,
    provider: profile.provider,
    effort: profile.effort,
    transport: profile.transport,
    timeout_ms: profile.timeout_ms,
    config_revision: profile.config_revision,
  };
}

/**
 * Birincil deneme başarısız olursa sırayla denenecek yedek profil yapılandırmaları.
 * Sıra `priority` kolonundan gelir (listProfiles zaten ona göre sıralar); birincil
 * ile aynı CLI atlanır — aynı CLI ikinci kez denemek aynı hatayı verir.
 *
 * Saf fonksiyon: hem yerel worker (DB'den okur) hem `/api/worker` claim yanıtı
 * (remote worker'a gönderir) aynı sırayı üretir.
 */
export function orderedFallbackConfigs(
  profiles: AgentProfileRow[],
  primaryCli: string | undefined,
): AiConfigSnapshot[] {
  return profiles
    .filter((profile) => profile.enabled === 1 && profile.cli !== primaryCli)
    .map((profile) => profileToSnapshot(profile));
}

/** İş snapshot'ına göre adapter seçimi: profil sabitlenmişse o, değilse ortam/otomatik. */
export function adapterForJobConfig(
  aiConfig: AiConfigSnapshot | null,
): { adapter: AgentAdapter | null; info: AgentRuntimeInfo } {
  if (aiConfig && aiConfig.kind === "profile" && aiConfig.cli) {
    const adapter = createProfileAdapter({
      cli: aiConfig.cli as SupportedCli,
      model: aiConfig.model ?? null,
      provider: aiConfig.provider ?? null,
      effort: aiConfig.effort ?? null,
      transport: aiConfig.transport === "argv" ? "argv" : "stdin",
      timeout_ms: aiConfig.timeout_ms,
    });
    return {
      adapter,
      info: { mode: "command", source: "profile", command: undefined },
    };
  }
  return resolveAdapter();
}

/** Uzun iş için env/CMD değerlerini log/meta'ya taşımayan güvenli provenance. */
export function provenanceFor(config: AiConfigSnapshot | null, adapterName: string): Record<string, unknown> {
  return {
    aiKind: config?.kind ?? "auto",
    aiName: config?.name ?? null,
    cli: config?.cli ?? adapterName,
    model: config?.model ?? null,
    configRevision: config?.config_revision ?? null,
  };
}
