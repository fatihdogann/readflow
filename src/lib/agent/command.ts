import { spawn } from "node:child_process";
import { AgentError, type AgentAdapter, type AgentRunResult, type AgentRunTask } from "./types";

/**
 * "claude -p 'merhaba dünya'" gibi tek satırlık komutları POSIX kurallarına göre
 * parçalar. Shell çalıştırılmaz; parçalar doğrudan argv olarak verilir, böylece
 * prompt/çıktı hiçbir kabuk yorumlamasına girmez.
 */
export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of input.trim()) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        hasToken = true;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken || current.length > 0) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (quote) throw new AgentError("Agent komutunda kapanmamış tırnak var");
  if (hasToken || current.length > 0) tokens.push(current);
  return tokens;
}

export interface CommandAdapterOptions {
  /** "stdin" (önerilen): prompt process'in standart girdisine yazılır. "argv": son argüman olarak verilir. */
  promptVia?: "stdin" | "argv";
  /** Görünen ad (ör. tespit edilen CLI adı). */
  label?: string;
}

const STDOUT_LIMIT = 4_000_000;
const STDERR_LIMIT = 100_000;

/**
 * Yapılandırılabilir yerel CLI çalıştırıcısı. Prompt stdin/argv ile verilir,
 * sonuç stdout'tan okunur. Belirli bir sağlayıcıya bağlı değildir.
 */
export class CommandAgentAdapter implements AgentAdapter {
  readonly name: string;
  private readonly promptVia: "stdin" | "argv";

  constructor(
    readonly command: string,
    options: CommandAdapterOptions = {},
  ) {
    this.promptVia = options.promptVia ?? "stdin";
    const program = tokenizeCommand(command)[0] ?? "bilinmeyen";
    this.name = options.label ?? program;
  }

  run(task: AgentRunTask): Promise<AgentRunResult> {
    const parts = tokenizeCommand(this.command);
    if (parts.length === 0) {
      return Promise.reject(new AgentError("Agent komutu boş"));
    }
    const [program, ...args] = parts;
    const finalArgs = this.promptVia === "argv" ? [...args, task.prompt] : args;

    return new Promise<AgentRunResult>((resolve, reject) => {
      let settled = false;
      const startedAt = Date.now();

      const child = spawn(program, finalArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.env.READFLOW_AGENT_CWD?.trim() || process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        settled = true;
        child.kill("SIGKILL");
        reject(new AgentError(`Agent zaman aşımına uğradı (${task.timeoutMs} ms)`));
      }, task.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > STDOUT_LIMIT) child.kill("SIGKILL");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > STDERR_LIMIT) stderr = stderr.slice(-STDERR_LIMIT);
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const hint =
          err.code === "ENOENT" ? " (komut bulunamadı — PATH'i kontrol edin)" : "";
        reject(new AgentError(`Agent çalıştırılamadı: ${err.message}${hint}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const text = stdout.trim();
        if (code !== 0) {
          const detail = stderr.trim().slice(-400) || text.slice(-400);
          reject(new AgentError(`Agent hata ile çıktı (kod ${code}): ${detail}`));
          return;
        }
        if (!text) {
          reject(new AgentError("Agent boş yanıt döndürdü"));
          return;
        }
        resolve({
          text,
          meta: {
            command: this.command,
            promptVia: this.promptVia,
            exitCode: code,
            durationMs: Date.now() - startedAt,
          },
        });
      });

      if (this.promptVia === "stdin") {
        child.stdin.on("error", () => {
          /* pipe kapanırsa sessiz geç: close/error handler'ları raporlar */
        });
        child.stdin.write(task.prompt);
        child.stdin.end();
      }
    });
  }
}
