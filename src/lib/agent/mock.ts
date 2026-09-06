import { AgentError, type AgentAdapter, type AgentRunResult, type AgentRunTask } from "./types";

/**
 * Testler ve offline demo için deterministik sahte adapter.
 * Prompt içindeki görev işaretine göre farklı markdown üretir.
 */
export class MockAgentAdapter implements AgentAdapter {
  readonly name = "mock";

  async run(task: AgentRunTask): Promise<AgentRunResult> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const prompt = task.prompt;
    const excerpt = prompt.slice(-400).trim().replace(/\s+/g, " ");
    let text: string;
    if (prompt.includes("[GÖREV: ÖZET")) {
      text = [
        "## Mock Özet",
        "",
        `Kaynak ${prompt.length} karakter olarak alındı.`,
        "",
        `- Ana fikir (mock): ${excerpt.slice(0, 160)}…`,
        "- Bu çıktı MockAgentAdapter tarafından üretildi.",
      ].join("\n");
    } else {
      text = [
        "## Mock Düzenleme",
        "",
        `Girdi ${prompt.length} karakter. Aşağıda orijinal akış korunarak bölümlemiş hali var (mock).`,
        "",
        "### Bölüm 1",
        "",
        excerpt.slice(0, 200),
        "",
        "### Bölüm 2",
        "",
        "- Mock madde 1",
        "- Mock madde 2",
      ].join("\n");
    }
    if (!text.trim()) throw new AgentError("Mock boş çıktı üretti");
    return { text, meta: { adapter: "mock", promptChars: prompt.length } };
  }
}
