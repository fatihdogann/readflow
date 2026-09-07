import { describe, expect, it } from "vitest";
import { buildQuoteContext, findQuoteRange, normalizeText, rangesOverlap } from "./match";

const ARTICLE = `Giriş bölümü burada yer alıyor.

Kira enflasyonu 2023-2024'te belirgin biçimde yükseldi. TOKİ teslimleri 2025'te hızlandı
ve bölgesel farklar açıldı.

Sonuç: arz toparlanması kiralar üzerinde baskı kuruyor.`;

describe("findQuoteRange", () => {
  it("yalın alıntıyı bulur ve orijinal ofset döndürür", () => {
    const match = findQuoteRange(ARTICLE, { quote: "bölgesel farklar açıldı" });
    expect(match).not.toBeNull();
    expect(ARTICLE.slice(match!.start, match!.end)).toBe("bölgesel farklar açıldı");
  });

  it("farklı boşluk/satır düzenine sahip alıntıyı normalize ederek bulur", () => {
    const match = findQuoteRange(ARTICLE, {
      quote: "hızlandı ve bölgesel farklar\naçildı".replace("açildı", "açıldı"),
    });
    expect(match).not.toBeNull();
    expect(ARTICLE.slice(match!.start, match!.end).replace(/\s+/g, " ")).toContain("hızlandı");
  });

  it("prefix+suffix bağlamı tekrarlanan alıntıyı ayırt eder", () => {
    const text = "kira arttı. Ara metin. kira arttı.";
    const withContext = findQuoteRange(text, {
      quote: "kira arttı",
      prefix: "Ara metin. ",
    });
    expect(withContext).not.toBeNull();
    expect(text.slice(withContext!.start, withContext!.end)).toBe("kira arttı");
    // bağlamla bulunamayan alıntı, ilk eşleşmeye düşer
    const fallback = findQuoteRange(text, { quote: "kira arttı" });
    expect(fallback!.start).toBe(0);
  });

  it("olmayan alıntı için null döner (bağlantı yok durumu)", () => {
    expect(findQuoteRange(ARTICLE, { quote: "metinde hiç geçmeyen cümle" })).toBeNull();
    expect(findQuoteRange(ARTICLE, { quote: "" })).toBeNull();
  });
});

describe("buildQuoteContext", () => {
  it("alıntı öncesi/sonrası bağlamı üretir", () => {
    const start = ARTICLE.indexOf("TOKİ");
    const end = start + 5;
    const context = buildQuoteContext(ARTICLE, start, end);
    expect(context.quote).toBe("TOKİ ");
    expect(context.prefix.length).toBeGreaterThan(0);
  });
});

describe("rangesOverlap", () => {
  it("çakışan aralıkları doğru bildirir", () => {
    expect(rangesOverlap({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(true);
    expect(rangesOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
  });
});

describe("çok satırlı ve boşluk-normalize eşleşme", () => {
  it("satır sonları ve çoklu boşluk alıntıyı bozmaz", () => {
    const text = "Birinci  satır\n\n   ikinci satır devam ediyor.";
    const range = findQuoteRange(text, { quote: "satır ikinci satır" });
    expect(range).not.toBeNull();
    expect(normalizeText(text.slice(range!.start, range!.end))).toBe("satır ikinci satır");
  });

  it("aynı metin iki kez geçiyorsa prefix doğru olanı seçer", () => {
    const text = "alfa hedef beta. gamma hedef delta.";
    const first = findQuoteRange(text, { quote: "hedef", prefix: "alfa" });
    const second = findQuoteRange(text, { quote: "hedef", prefix: "gamma" });
    expect(first!.start).toBeLessThan(second!.start);
    expect(text.slice(second!.start, second!.end)).toBe("hedef");
  });

  it("metinde olmayan alıntı null döner (panelde 'bağlanamadı')", () => {
    expect(findQuoteRange("kısa metin", { quote: "burada olmayan cümle" })).toBeNull();
  });

  it("buildQuoteContext bağlamı alıntıyı içermez", () => {
    const text = "önce gelen kısım SEÇİM sonra gelen kısım";
    const start = text.indexOf("SEÇİM");
    const context = buildQuoteContext(text, start, start + 5);
    expect(context.quote).toBe("SEÇİM");
    expect(context.prefix).not.toContain("SEÇİM");
    expect(context.suffix).not.toContain("SEÇİM");
    // Bağlamla birlikte tekrar bulunabilmeli
    expect(findQuoteRange(text, context)).toEqual({ start, end: start + 5 });
  });
});
