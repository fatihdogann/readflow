import { describe, expect, it } from "vitest";
import { buildQuoteContext, findQuoteRange, rangesOverlap } from "./match";

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
