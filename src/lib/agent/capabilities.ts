import { spawnSync } from "node:child_process";

export type SupportedCli = "claude" | "codex" | "jcode";

export interface CliCapabilities {
  cli: SupportedCli;
  /** PATH'te bulunuyor mu */
  found: boolean;
  /** `--version` çıktısı (kısa) */
  version: string | null;
  /** Doğrulanmış non-interactive kullanım (işlem yapılabilir demek değil) */
  nonInteractive: boolean;
  /** `--model` / `-m` bayrağı help çıktısında doğrulandı mı */
  modelFlag: boolean;
  /** `-p/--provider` bayrağı doğrulandı mı (jcode) */
  providerFlag: boolean;
  /** salt-okunur sandbox bayrağı doğrulandı mı (codex) */
  sandboxReadonlyFlag: boolean;
  /** `--effort <level>` bayrağı doğrulandı mı (claude) */
  effortFlag: boolean;
  /** `-c key=value` config override bayrağı doğrulandı mı (codex: reasoning effort buradan) */
  configOverrideFlag: boolean;
  /** Prompt mutlaka konumsal argüman olarak mı verilmeli (jcode: <MESSAGE>) */
  argvRequired: boolean;
  /** `--json` makine-okur sonuç bayrağı doğrulandı mı (jcode) */
  jsonFlag: boolean;
  /** CLI'ın kendi doğrulanabilir model kataloğu (jcode `model list`) */
  modelOptions: string[] | null;
  /** Help metnine dayalı ek not (bayrak uydurmak için değil) */
  notes: string[];
}

interface HelpProbe {
  ok: boolean;
  output: string;
}

export type HelpRunner = (cli: SupportedCli, args: string[]) => HelpProbe;

const defaultRunner: HelpRunner = (cli, args) => {
  const options = { timeout: 8000, encoding: "utf8" as const, windowsHide: true };
  let result: ReturnType<typeof spawnSync>;
  if (cli === "claude") result = spawnSync("claude", args, options);
  else if (cli === "codex") result = spawnSync("codex", args);
  else if (cli === "jcode") result = spawnSync("jcode", args);
  else return { ok: false, output: "" };
  if (result.error) return { ok: false, output: "" };
  return { ok: true, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
};

function firstLine(text: string): string | null {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line ? line.slice(0, 120) : null;
}

/**
 * Kurulu CLI'ların gerçek `--help` / `--version` çıktısından yetenek çıkarımı.
 * Bayraklar asla uydurulmaz: regex help metninde doğrulanamazsa false kalır.
 * Model kataloğu yalnızca CLI'ın kendi listeleme komutu varsa alınır (jcode).
 */
export function discoverCapabilities(cli: SupportedCli, runner: HelpRunner = defaultRunner): CliCapabilities {
  const caps: CliCapabilities = {
    cli,
    found: false,
    version: null,
    nonInteractive: false,
    modelFlag: false,
    providerFlag: false,
    sandboxReadonlyFlag: false,
    effortFlag: false,
    configOverrideFlag: false,
    argvRequired: false,
    jsonFlag: false,
    modelOptions: null,
    notes: [],
  };

  const help = runner(cli, ["--help"]);
  if (!help.ok) return caps;
  caps.found = true;

  const version = runner(cli, ["--version"]);
  caps.version = version.ok ? firstLine(version.output) : null;

  const execHelp = cli === "codex" ? runner(cli, ["exec", "--help"]) : null;
  const runHelp = cli === "jcode" ? runner(cli, ["run", "--help"]) : null;
  const combined = `${help.output}\n${execHelp?.ok ? execHelp.output : ""}\n${runHelp?.ok ? runHelp.output : ""}`;

  if (cli === "claude") {
    caps.nonInteractive = /--print\b/.test(help.output) && /non-interactive/i.test(help.output);
    caps.modelFlag = /(^|\s)--model\b/.test(help.output);
    // "--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)"
    caps.effortFlag = /(^|\s)--effort\b/.test(help.output);
  } else if (cli === "codex") {
    caps.nonInteractive = /\bexec\b/.test(help.output) && /non-interactive/i.test(help.output);
    caps.modelFlag = /(^|\s)-m,|--model\b/.test(combined);
    caps.sandboxReadonlyFlag = /--sandbox\b/.test(combined) && /read-only/.test(combined);
    // codex'te ayrı bir --effort bayrağı yok; reasoning effort config override ile verilir.
    caps.configOverrideFlag = /(^|\s)-c, --config\b/.test(combined);
  } else if (cli === "jcode") {
    caps.nonInteractive = /Run a single message and exit/i.test(help.output);
    caps.modelFlag = /(^|\s)--model\b/.test(combined);
    caps.providerFlag = /(^|\s)-p, --provider\b/.test(combined);
    caps.jsonFlag = /(^|\s)--json\b/.test(combined);
    // jcode run <MESSAGE>: prompt konumsal argüman olarak zorunlu.
    caps.argvRequired = runHelp?.ok === true && /<MESSAGE>/.test(runHelp.output);
  }

  if (execHelp?.ok && /read from stdin|from standard input/i.test(execHelp.output)) {
    caps.notes.push("codex exec stdin'den prompt okur");
  }
  if (runHelp?.ok && /<MESSAGE>/.test(runHelp.output)) {
    caps.notes.push("jcode run mesajı argüman olarak ister");
  }
  if (caps.found && !caps.effortFlag && !caps.configOverrideFlag) {
    caps.notes.push("reasoning effort bayrağı yok — profildeki effort değeri yok sayılır");
  }

  // Doğrulanabilir model kataloğu: yalnızca CLI'ın kendi listeleme komutu varsa.
  if (cli === "jcode") {
    const list = runner(cli, ["model", "list"]);
    if (list.ok && list.output.trim().length > 0) {
      const ids = list.output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[a-z0-9][a-z0-9.\-/\[\]]*$/i.test(line))
        .slice(0, 300);
      if (ids.length > 0) caps.modelOptions = ids;
    }
  }
  return caps;
}

const CAPS_TTL_MS = 5 * 60 * 1000;
const cache = new Map<SupportedCli, { caps: CliCapabilities; at: number }>();

/** Süreç içi önbellekli discovery (worker/MCP/settings tekrar tekrar help çalıştırmasın). */
export function getCachedCapabilities(cli: SupportedCli, runner?: HelpRunner): CliCapabilities {
  const hit = cache.get(cli);
  if (hit && Date.now() - hit.at < CAPS_TTL_MS && !runner) return hit.caps;
  const caps = discoverCapabilities(cli, runner);
  if (!runner) cache.set(cli, { caps, at: Date.now() });
  return caps;
}

export function discoverAllCapabilities(runner?: HelpRunner): CliCapabilities[] {
  return (["claude", "codex", "jcode"] as SupportedCli[]).map((cli) =>
    getCachedCapabilities(cli, runner),
  );
}
