import { CommandAgentAdapter } from "./command";
import { detectAgentCommand } from "./detect";
import { MockAgentAdapter } from "./mock";
import type { AgentAdapter, AgentRuntimeInfo } from "./types";

export { tokenizeCommand, CommandAgentAdapter } from "./command";
export { detectAgentCommand } from "./detect";
export { MockAgentAdapter } from "./mock";
export type { AgentAdapter, AgentRunResult, AgentRunTask, AgentRuntimeInfo } from "./types";
export { AgentError } from "./types";

export function agentTimeoutMs(): number {
  const raw = Number(process.env.READFLOW_AGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 120_000;
}

/**
 * Adapter seçimi:
 *  1. READFLOW_AGENT_MODE=mock  -> MockAgentAdapter
 *  2. READFLOW_AGENT_MODE=none  -> bağlantı yok (job'lar pending kalır)
 *  3. READFLOW_AGENT_CMD        -> CommandAgentAdapter (env kaynaklı)
 *  4. READFLOW_AGENT_MODE=command ve CMD yok -> bağlantı yok + uyarı
 *  5. auto: bilinen CLI preset'lerini --help imzasıyla doğrula, bulunursa kullan
 *  6. hiçbiri -> bağlantı yok; site çalışmaya devam eder, job'lar pending kalır
 */
export function resolveAdapter(): { adapter: AgentAdapter | null; info: AgentRuntimeInfo } {
  const mode = (process.env.READFLOW_AGENT_MODE ?? "auto").trim().toLowerCase();
  const cmdEnv = process.env.READFLOW_AGENT_CMD?.trim();

  if (mode === "mock") {
    return { adapter: new MockAgentAdapter(), info: { mode: "mock" } };
  }
  if (mode === "none") {
    return {
      adapter: null,
      info: { mode: "none", message: "Agent bağlantısı devre dışı (READFLOW_AGENT_MODE=none)" },
    };
  }
  if (cmdEnv) {
    const promptVia =
      process.env.READFLOW_AGENT_PROMPT_VIA?.trim().toLowerCase() === "argv" ? "argv" : "stdin";
    return {
      adapter: new CommandAgentAdapter(cmdEnv, { promptVia }),
      info: { mode: "command", command: cmdEnv, source: "env" },
    };
  }
  if (mode === "command") {
    return {
      adapter: null,
      info: {
        mode: "none",
        message: "READFLOW_AGENT_MODE=command ama READFLOW_AGENT_CMD tanımlı değil",
      },
    };
  }

  const { detected, found } = detectAgentCommand();
  if (detected) {
    return {
      adapter: new CommandAgentAdapter(detected.command, {
        promptVia: detected.promptVia,
        label: detected.cli,
      }),
      info: {
        mode: "command",
        command: detected.command,
        source: "detected",
        candidatesFound: found,
      },
    };
  }
  return {
    adapter: null,
    info: {
      mode: "none",
      candidatesFound: found,
      message: found.length
        ? `Bulunan CLI'lar için non-interactive kullanım doğrulanamadı: ${found.join(", ")}. READFLOW_AGENT_CMD ile manuel bağlayın.`
        : "Kurulu coding-agent CLI bulunamadı. README: READFLOW_AGENT_CMD ile bağlayın.",
    },
  };
}
