import { describe, expect, it } from "vitest";
import { discoverCapabilities, type HelpRunner } from "./capabilities";
import {
  buildArgvForProfile,
  buildCommandForProfile,
  parseJcodeJsonOutput,
  resolveTransport,
  stripTrailingTokenLine,
} from "./profiles";

const claudeHelp = `
  -p, --print             Print response without interactive mode (non-interactive output)
  --model <model>         Model to use
  --effort <level>        Effort level for the current session (low, medium, high, xhigh, max)
`;
const codexHelp = `
  exec              Run Codex non-interactively [aliases: e]
`;
const codexExecHelp = `
  -c, --config <key=value>  Override a configuration value
  -m, --model <MODEL>       Model to use
  --sandbox <SANDBOX>       read-only|workspace-write|danger-full-access
  Read the prompt from standard input when '-'
`;
const jcodeHelp = `
  run    Run a single message and exit
  -p, --provider <PROVIDER>  Initial provider
  --model <model>
`;
const jcodeRunHelp = `
Usage: jcode run [OPTIONS] <MESSAGE>

Arguments:
  <MESSAGE>
          The message to send
Options:
  --json
          Emit a machine-readable JSON result
  --model <model>
`;

function runnerFor(help: string, execHelp?: string, runHelp?: string): HelpRunner {
  return (_cli, args) => {
    if (args[0] === "--help") return { ok: true, output: help };
    if (args[0] === "exec" && args[1] === "--help") {
      return { ok: args.includes("--help"), output: execHelp ?? "" };
    }
    if (args[0] === "run" && args[1] === "--help") {
      return { ok: true, output: runHelp ?? "" };
    }
    if (args[0] === "--version") return { ok: true, output: "test-1.0.0" };
    if (args[0] === "model" && args[1] === "list") return { ok: true, output: "glm-5.3-flash\nglm-5.2\n" };
    return { ok: false, output: "" };
  };
}

describe("capability discovery (yardım çıktısından doğrulama)", () => {
  it("claude: --print ve --model doğrulanır", () => {
    const caps = discoverCapabilities("claude", runnerFor(claudeHelp));
    expect(caps.found).toBe(true);
    expect(caps.nonInteractive).toBe(true);
    expect(caps.modelFlag).toBe(true);
    expect(caps.version).toBe("test-1.0.0");
  });

  it("codex: exec + model + sandbox + config override doğrulanır", () => {
    const caps = discoverCapabilities("codex", runnerFor(codexHelp, codexExecHelp));
    expect(caps.nonInteractive).toBe(true);
    expect(caps.modelFlag).toBe(true);
    expect(caps.sandboxReadonlyFlag).toBe(true);
    expect(caps.configOverrideFlag).toBe(true);
    // codex'te ayrı --effort bayrağı yok
    expect(caps.effortFlag).toBe(false);
  });

  it("jcode: run + provider doğrulanır, <MESSAGE> argv zorunluluğu ve model kataloğu alınır", () => {
    const caps = discoverCapabilities("jcode", runnerFor(jcodeHelp, undefined, jcodeRunHelp));
    expect(caps.nonInteractive).toBe(true);
    expect(caps.providerFlag).toBe(true);
    expect(caps.modelFlag).toBe(true);
    expect(caps.argvRequired).toBe(true);
    expect(caps.modelOptions).toContain("glm-5.3-flash");
    expect(resolveTransport(caps, "stdin")).toBe("argv");
  });

  it("claude: --effort doğrulanır", () => {
    const caps = discoverCapabilities("claude", runnerFor(claudeHelp));
    expect(caps.effortFlag).toBe(true);
  });

  it("jcode: effort bayrağı yok — uydurulmaz", () => {
    const caps = discoverCapabilities("jcode", runnerFor(jcodeHelp, undefined, jcodeRunHelp));
    expect(caps.effortFlag).toBe(false);
    expect(caps.configOverrideFlag).toBe(false);
  });

  it("jcode run help yoksa argv zorunluluğu uydurulmaz", () => {
    const caps = discoverCapabilities("jcode", runnerFor(jcodeHelp));
    expect(caps.argvRequired).toBe(false);
    expect(resolveTransport(caps, "stdin")).toBe("stdin");
  });

  it("help çalışmazsa found=false kalır ve bayrak uydurulmaz", () => {
    const caps = discoverCapabilities("claude", () => ({ ok: false, output: "" }));
    expect(caps.found).toBe(false);
    expect(caps.nonInteractive).toBe(false);
    expect(caps.modelFlag).toBe(false);
  });
});

describe("profil komut üretimi (shellsiz argv kaynağı)", () => {
  it("yalnızca doğrulanmış bayrakları ekler", () => {
    const claude = buildCommandForProfile({ cli: "claude", model: "claude-sonnet-x" }, {
      ...discoverCapabilities("claude", runnerFor(claudeHelp)),
    });
    expect(claude).toBe("claude -p --model claude-sonnet-x");

    const codex = buildCommandForProfile({ cli: "codex", model: "gpt-x" }, discoverCapabilities("codex", runnerFor(codexHelp, codexExecHelp)));
    expect(codex).toBe("codex exec --sandbox read-only -m gpt-x -");

    const jcode = buildCommandForProfile(
      { cli: "jcode", provider: "claude", model: "m" },
      discoverCapabilities("jcode", runnerFor(jcodeHelp)),
    );
    expect(jcode).toBe("jcode run --provider claude --model m");
  });

  it("effort yalnızca doğrulanmış bayrakla taşınır", () => {
    const claudeCaps = discoverCapabilities("claude", runnerFor(claudeHelp));
    expect(buildCommandForProfile({ cli: "claude", model: "opus-5", effort: "medium" }, claudeCaps)).toBe(
      "claude -p --model opus-5 --effort medium",
    );

    // codex: --effort yok, config override ile TOML string olarak verilir
    const codexCaps = discoverCapabilities("codex", runnerFor(codexHelp, codexExecHelp));
    expect(buildArgvForProfile({ cli: "codex", model: "gpt-5.6-terra", effort: "medium" }, codexCaps)).toEqual([
      "codex",
      "exec",
      "--sandbox",
      "read-only",
      "-m",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="medium"',
      "-",
    ]);

    // jcode: effort bayrağı yok — değer sessizce düşer
    const jcodeCaps = discoverCapabilities("jcode", runnerFor(jcodeHelp, undefined, jcodeRunHelp));
    expect(buildCommandForProfile({ cli: "jcode", model: "glm-5.3-flash", effort: "max" }, jcodeCaps)).toBe(
      "jcode run --json --model glm-5.3-flash",
    );
  });

  it("geçersiz effort değeri argv'ya girmez", () => {
    const caps = discoverCapabilities("claude", runnerFor(claudeHelp));
    expect(buildCommandForProfile({ cli: "claude", effort: "turbo" }, caps)).toBe("claude -p");
  });

  it("doğrulanmamış bayrak varsa sessizce düşürür (uydurma yok)", () => {
    const caps = discoverCapabilities("claude", runnerFor("-p, --print\n  non-interactive mode"));
    expect(caps.modelFlag).toBe(false);
    expect(buildCommandForProfile({ cli: "claude", model: "m" }, caps)).toBe("claude -p");
  });

  it("model değeri argv'da tek token olarak korunur (shellsiz spawn)", () => {
    const caps = discoverCapabilities("claude", runnerFor(claudeHelp));
    const argv = buildArgvForProfile({ cli: "claude", model: "x y z" }, caps);
    expect(argv).toEqual(["claude", "-p", "--model", "x y z"]);
  });

  it("jcode argv'sı --json + provider/model bayraklarını taşır", () => {
    const caps = discoverCapabilities("jcode", runnerFor(jcodeHelp, undefined, jcodeRunHelp));
    expect(caps.jsonFlag).toBe(true);
    const argv = buildArgvForProfile({ cli: "jcode", provider: "zai", model: "glm-5.3-flash" }, caps);
    expect(argv).toEqual(["jcode", "run", "--json", "--provider", "zai", "--model", "glm-5.3-flash"]);
  });

  it("jcode --json çıktısından yalnızca mesaj metni alınır (reasoning/token temizliği)", () => {
    expect(parseJcodeJsonOutput('{"session_id":"s","text":"TAMAM","usage":{}}')).toBe("TAMAM");
    // JSON çözülemezse düz metne düşer ve [Tokens] satırı kırpılır
    expect(parseJcodeJsonOutput("TAMAM\n[Tokens] upload: 17507")).toBe("TAMAM");
    expect(parseJcodeJsonOutput("TAMAM")).toBe("TAMAM");
  });

  it("jcode token metadata satırı yalnızca sondaysa kırpılır", () => {
    expect(stripTrailingTokenLine("TAMAM\n[Tokens] upload: 17507 download: 5")).toBe("TAMAM");
    expect(stripTrailingTokenLine("içerikte [Tokens] var\n\nTAMAM")).toBe("içerikte [Tokens] var\n\nTAMAM");
    expect(stripTrailingTokenLine("TAMAM")).toBe("TAMAM");
  });
});
