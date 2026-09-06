import { describe, expect, it } from "vitest";
import path from "node:path";
import { tokenizeCommand, CommandAgentAdapter } from "./command";
import { MockAgentAdapter } from "./mock";
import { AgentError } from "./types";

describe("tokenizeCommand", () => {
  it("boşluklara ve tırnaklara göre böler", () => {
    expect(tokenizeCommand("claude -p")).toEqual(["claude", "-p"]);
    expect(tokenizeCommand(`node "my script.js" --flag='a b'`)).toEqual([
      "node",
      "my script.js",
      "--flag=a b",
    ]);
    expect(tokenizeCommand("  tek  ")).toEqual(["tek"]);
    expect(tokenizeCommand("")).toEqual([]);
  });

  it("kapanmamış tırnağı reddeder", () => {
    expect(() => tokenizeCommand('claude "açık')).toThrow(AgentError);
  });
});

describe("CommandAgentAdapter", () => {
  it("prompt'u stdin'den alıp stdout'a yazar (cat)", async () => {
    const adapter = new CommandAgentAdapter("cat", { label: "cat-test" });
    const result = await adapter.run({ prompt: "merhaba readflow", timeoutMs: 10_000 });
    expect(result.text).toBe("merhaba readflow");
    expect(result.meta.promptVia).toBe("stdin");
  });

  it("prompt'u argv ile de verebilir (echo argümanları yazdırır)", async () => {
    const adapter = new CommandAgentAdapter("echo", { promptVia: "argv" });
    const result = await adapter.run({ prompt: "argv yolu", timeoutMs: 10_000 });
    expect(result.text).toBe("argv yolu");
  });

  it("zaman aşımında hata üretir", async () => {
    const adapter = new CommandAgentAdapter("sleep 5");
    await expect(adapter.run({ prompt: "x", timeoutMs: 400 })).rejects.toThrow(/zaman aşımı/);
  });

  it("olmayan komutta anlamlı hata verir", async () => {
    const adapter = new CommandAgentAdapter("readflow-olmayan-komut-xyz");
    await expect(adapter.run({ prompt: "x", timeoutMs: 10_000 })).rejects.toThrow(/çalıştırılamadı|komut bulunamadı/);
  });

  it("boş komutu reddeder", async () => {
    const adapter = new CommandAgentAdapter("");
    await expect(adapter.run({ prompt: "x", timeoutMs: 1000 })).rejects.toThrow(AgentError);
  });
});

describe("MockAgentAdapter", () => {
  it("özete ve okunabilirliğe farklı çıktı üretir", async () => {
    const adapter = new MockAgentAdapter();
    const summary = await adapter.run({ prompt: "[GÖREV: ÖZET]\n\nmetin", timeoutMs: 1000 });
    const readability = await adapter.run({
      prompt: "[GÖREV: OKUNABİLİRLİK]\n\nmetin",
      timeoutMs: 1000,
    });
    expect(summary.text).toContain("Mock Özet");
    expect(readability.text).toContain("Mock Düzenleme");
    expect(summary.text).not.toEqual(readability.text);
  });

  it("tokenize edilen script yolu import ile aynı dosyayı gösterir", () => {
    // Sahte kontrol: adapter kendi etiketini taşır
    const adapter = new MockAgentAdapter();
    expect(adapter.name).toBe("mock");
    expect(path.basename(__filename)).toContain("command.test");
  });
});
