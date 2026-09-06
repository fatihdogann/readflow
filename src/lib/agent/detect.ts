import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface DetectedAgent {
  cli: string;
  command: string;
  promptVia: "stdin" | "argv";
}

export interface DetectionResult {
  detected: DetectedAgent | null;
  found: string[];
}

/**
 * Bilinen CLI preset'leri. Kural: komut satırı bayrakları tahmin edilmez;
 * her preset yalnızca ilgili CLI'ın kendi `--help` çıktısındaki imza doğrulanırsa
 * kullanılır. Doğrulanamayan CLI'lar yalnızca "bulundu" olarak raporlanır.
 */
const PRESETS: Array<{
  cli: string;
  isSupported: (help: string) => boolean;
  commandFor: (cli: string) => string;
  promptVia: "stdin" | "argv";
}> = [
  {
    cli: "claude",
    isSupported: (help) => /--print\b/.test(help) && /non-interactive/i.test(help),
    commandFor: (cli) => `${cli} -p`,
    promptVia: "stdin",
  },
  {
    cli: "codex",
    isSupported: (help) => /\bexec\b/.test(help) && /non-interactive/i.test(help),
    commandFor: (cli) => `${cli} exec -`,
    promptVia: "stdin",
  },
  {
    cli: "jcode",
    isSupported: (help) => /Run a single message and exit/i.test(help),
    commandFor: (cli) => `${cli} run`,
    promptVia: "argv",
  },
];

function findOnPath(cli: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cli);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // bu dizinde yok
    }
  }
  return false;
}

/** `--help` çağrıları literal CLI adlarıyla yapılır; shell kullanılmaz. */
function readHelp(cli: string): string | null {
  const options = { timeout: 8000, encoding: "utf8" as const, windowsHide: true };
  let result: ReturnType<typeof spawnSync>;
  if (cli === "claude") {
    result = spawnSync("claude", ["--help"], options);
  } else if (cli === "codex") {
    result = spawnSync("codex", ["--help"], options);
  } else if (cli === "jcode") {
    result = spawnSync("jcode", ["--help"], options);
  } else {
    return null;
  }
  if (result.error) return null;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

export function detectAgentCommand(): DetectionResult {
  const found: string[] = [];
  for (const preset of PRESETS) {
    if (!findOnPath(preset.cli)) continue;
    found.push(preset.cli);
    const help = readHelp(preset.cli);
    if (help && preset.isSupported(help)) {
      return {
        detected: {
          cli: preset.cli,
          command: preset.commandFor(preset.cli),
          promptVia: preset.promptVia,
        },
        found,
      };
    }
  }
  return { detected: null, found };
}
