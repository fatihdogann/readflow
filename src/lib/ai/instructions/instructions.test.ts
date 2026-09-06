import { describe, expect, it } from "vitest";
import {
  buildPromptForJob,
  buildPromptForSnapshot,
  buildReadabilityPrompt,
  buildSummaryPrompt,
} from "./index";

const SAMPLE = "Yapay zeka bellek konusunu ele alan bir metin. 2026 verileri içeriyor.";

describe("AI instructions", () => {
  it("okunabilirlik promptu görevi ve katı kuralları içerir", () => {
    const prompt = buildReadabilityPrompt(SAMPLE);
    expect(prompt).toContain("[GÖREV: OKUNABİLİRLİK]");
    expect(prompt).toContain(SAMPLE);
    expect(prompt).toContain("YENİDEN YAZMADAN");
    expect(prompt).toContain("Sayısal verileri");
    expect(prompt).toContain("kaynakta olmayan hiçbir bilgi ekleme");
  });

  it("üç özet seviyesi farklı davranış tanımlar", () => {
    const short = buildSummaryPrompt(SAMPLE, "short");
    const normal = buildSummaryPrompt(SAMPLE, "normal");
    const detailed = buildSummaryPrompt(SAMPLE, "detailed");
    expect(short).toContain("KISA");
    expect(normal).toContain("NORMAL");
    expect(detailed).toContain("DETAYLI");
    expect(new Set([short, normal, detailed]).size).toBe(3);
    for (const prompt of [short, normal, detailed]) {
      expect(prompt).toContain(SAMPLE);
      expect(prompt).toContain("Kaynakta olmayan bilgi üretme");
      expect(prompt).toContain("[GÖREV: ÖZET]");
    }
  });

  it("buildPromptForJob operasyona göre yönlendirir ve boş seviyeyi normal yapar", () => {
    const readability = buildPromptForJob("readability", "", SAMPLE);
    const summary = buildPromptForJob("summary", "", SAMPLE);
    expect(readability).toContain("[GÖREV: OKUNABİLİRLİK]");
    expect(summary).toContain("SEVİYE: NORMAL");
  });

  it("çok uzun metinler kısaltma notu ile korunur", () => {
    const huge = "kelime ".repeat(20_000); // ~140k karakter
    const prompt = buildReadabilityPrompt(huge);
    expect(prompt).toContain("[NOT: Kaynak metin çok uzun");
    expect(prompt.length).toBeLessThan(huge.length);
  });

  it("snapshot görselleri ve notlar prompt'a kural listesiyle girer", () => {
    const prompt = buildPromptForSnapshot({
      operation: "summary",
      summaryLevel: "normal",
      sourceText: "kısa metin",
      notesIncluded: true,
      notesText: "kullanıcı notu",
      images: ["https://ornek.com/grafik.png"],
    });
    expect(prompt).toContain("=== MAKALEDEKİ GÖRSELLER ===");
    expect(prompt).toContain("https://ornek.com/grafik.png");
    expect(prompt).toContain("![kısa açıklama](görsel-adresi)");
    expect(prompt).toContain("asla yeni adres uydurma");
    expect(prompt).toContain("=== KULLANICI NOTLARI (ek bağlam) ===");

    const without = buildPromptForSnapshot({
      operation: "summary",
      summaryLevel: "normal",
      sourceText: "kısa metin",
      notesIncluded: false,
      notesText: null,
    });
    expect(without).not.toContain("MAKALEDEKİ GÖRSELLER");
    expect(without).not.toContain("KULLANICI NOTLARI");
  });
});
