import { isSummaryLevel, type Operation, type StoredSummaryLevel, type SummaryLevel } from "../../types";

/** Çok uzun metinler agent bağlamını taşıyamaz; nazikçe kısaltılır. */
const MAX_PROMPT_CHARS = 80_000;

function withTextGuard(originalText: string): string {
  if (originalText.length <= MAX_PROMPT_CHARS) return originalText;
  const sliced = originalText.slice(0, MAX_PROMPT_CHARS);
  const cut = originalText.slice(MAX_PROMPT_CHARS).search(/\s/);
  const trimmed = cut === -1 ? sliced : sliced.slice(0, MAX_PROMPT_CHARS + cut);
  return `${trimmed}\n\n[NOT: Kaynak metin çok uzun olduğu için bu noktadan sonrası kısaltıldı.]`;
}

/**
 * Okunabilirlik operasyonu bir yeniden-yazım veya özetleme DEĞİLDİR.
 * Aşağıdaki talimat bu sınırı açıkça tanımlar (ürün spec'i #12).
 */
export function buildReadabilityPrompt(originalText: string): string {
  return `Sen bir profesyonel metin düzenleyicisin. Sana bir makalenin düz metni verilecek. Görevin: metni YENİDEN YAZMADAN, anlamı ve bilgi yoğunluğunu koruyarak yalnızca YAPISAL olarak okunabilirliğini artırmak.

[GÖREV: OKUNABİLİRLİK]

İHLAL EDİLEMEZ KURALLAR:
1. Hiçbir önemli bilgiyi çıkarma. İçeriğin bilgi yoğunluğu korunmalıdır.
2. Sayısal verileri, oranları, para birimlerini ve ölçüleri birebir koru.
3. Kişi, kurum, ürün ve yer isimlerini değiştirme.
4. Teknik terimleri gereksiz yere basitleştirme veya değiştirme.
5. Yorum yapma; anlamı değiştirme; kaynakta olmayan hiçbir bilgi ekleme.
6. Gereksiz tekrarları yalnızca açıkça tekrar ise azaltabilirsin.

YAPABİLECEKLERİN:
- Paragrafları mantıksal bölümlere ayırmak
- Bölümlere, metinde geçen bilgiyi yansıtan başlıklar ve alt başlıklar eklemek
- Uygun yerlerde listeler ve madde işaretleri kullanmak
- Karmaşık ve uzun blokları anlamı korunarak daha okunabilir sunmak
- Anlamı bozmayan yerlerde uzun cümleleri bölmek
- Fazla whitespace'i temizlemek

ÇIKTI FORMATI:
- Yalnızca Markdown döndür.
- Yanıtının başında veya sonunda açıklama, önsöz, "İşte ...", "Umarım yardımcı olur" gibi ifadeler YOK.
- Metnin dilini koru: kaynak Türkçe ise Türkçe, İngilizce ise İngilizce düzenle.

=== METİN BAŞLANGICI ===
${withTextGuard(originalText)}
=== METİN SONU ===`;
}

const LEVEL_RULES: Record<SummaryLevel, string> = {
  short:
    "SEVİYE: KISA — yalnızca ana fikirler ve kritik sonuçlar. Hedef: en fazla ~150 kelime veya 5-8 madde.",
  normal:
    "SEVİYE: NORMAL — ana argümanlar, kritik veriler ve önemli gerekçeler. Hedef: ~250-450 kelime; başlıklar ve maddeler kullanabilirsin.",
  detailed:
    "SEVİYE: DETAYLI — orijinal metnin önemli bilgi ve nüanslarının büyük bölümünü koruyan, bölümlenmiş kapsamlı özet. Hedef: ~600-1000 kelime; bölümler, alt başlıklar ve listeler kullan.",
};

export function buildSummaryPrompt(originalText: string, level: SummaryLevel): string {
  return `Sen bir profesyonel editör-asistansın. Aşağıdaki metni belirtilen seviyede özetle.

[GÖREV: ÖZET]

${LEVEL_RULES[level]}

HER SEVİYEDE GEÇERLİ KURALLAR:
1. Rakamları, istatistikleri, para birimlerini ve ölçüleri koru.
2. Kişi, kurum, ürün ve yer isimlerini koru.
3. Önemli tarihleri koru.
4. Teknik anlamı bozma; terimleri değiştirme.
5. Kaynakta olmayan bilgi üretme; yorum ekleme.
6. Özeti metnin dilinde yaz: kaynak Türkçe ise Türkçe, İngilizce ise İngilizce.

ÇIKTI FORMATI:
- Yalnızca Markdown döndür.
- Yanıtının başında veya sonunda açıklama, önsöz gibi ifadeler YOK.

=== METİN BAŞLANGICI ===
${withTextGuard(originalText)}
=== METİN SONU ===`;
}

export function buildPromptForJob(
  operation: Operation,
  summaryLevel: StoredSummaryLevel,
  originalText: string,
): string {
  if (operation === "readability") {
    return buildReadabilityPrompt(originalText);
  }
  const level: SummaryLevel = isSummaryLevel(summaryLevel) ? summaryLevel : "normal";
  return buildSummaryPrompt(originalText, level);
}

/** Kullanıcının açıkça dahil ettiği notlar; bağlam olarak verilir, çıktıya kopyalanmaz. */
export function buildPromptForSnapshot(input: {
  operation: Operation;
  summaryLevel: StoredSummaryLevel;
  sourceText: string;
  notesIncluded: boolean;
  notesText: string | null;
}): string {
  const base = buildPromptForJob(input.operation, input.summaryLevel, input.sourceText);
  if (!input.notesIncluded || !input.notesText?.trim()) return base;
  return `${base}

=== KULLANICI NOTLARI (ek bağlam) ===
Aşağıdaki notlar dokümanın sahibi tarafından eklenmiştir; yalnızca bağlam içindir.
Çıktına kopyalanmaz, ayrı bir "not" bölümü olarak eklenmez; içeriği anlamaya yardım eder.

${input.notesText.trim()}
=== KULLANICI NOTLARI SONU ===`;
}
