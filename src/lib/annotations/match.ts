export interface MatchedRange {
  start: number;
  end: number;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Alıntıyı hedef metinde normalize edilmiş eşleştirmeyle bulur.
 * Öncelik: prefix+quote+suffix bağlamı → yalnızca quote (ilk eşleşme).
 * Bulunamazsa null döner ("bağlantısı bulunamadı" durumu).
 * Dönen konumlar ORİJİNAL (normalize edilmemiş) metin üzerindedir.
 */
export function findQuoteRange(
  fullText: string,
  annotation: { quote: string; prefix?: string; suffix?: string },
): MatchedRange | null {
  const quote = annotation.quote.trim();
  if (!quote) return null;

  const normFull = normalizeText(fullText);
  const normQuote = normalizeText(quote);
  const normPrefix = normalizeText(annotation.prefix ?? "");
  const normSuffix = normalizeText(annotation.suffix ?? "");

  // Normalize metin ↔ orijinal metin konum eşlemesi (boşluk sıkıştırmayı geri sar)
  const map: number[] = [];
  let ni = 0;
  let inWs = false;
  let started = false;
  for (let oi = 0; oi < fullText.length && ni <= normFull.length; oi++) {
    const ch = fullText[oi];
    const isWs = /\s/.test(ch);
    if (isWs && started) {
      // Boşluk dizisinin yalnızca İLK karakteri norm'daki tek boşluğu temsil eder.
      if (!inWs) {
        map[ni++] = oi;
        inWs = true;
      }
      continue;
    }
    if (isWs) continue; // baştaki boşluklar
    inWs = false;
    map[ni] = oi;
    ni += 1;
    started = true;
  }
  map[ni] = fullText.length;

  const locate = (haystack: string, needle: string, from: number): number => {
    if (!needle) return -1;
    return haystack.indexOf(needle, from);
  };

  let nStart = -1;
  let nEnd = -1;

  if (normPrefix) {
    const p = locate(normFull, normPrefix, 0);
    if (p === -1) {
      // bağlam bulunamadı: yalnızca alıntıyla dene
    } else {
      const q = locate(normFull, normQuote, p + normPrefix.length);
      if (q !== -1) {
        nStart = q;
        nEnd = q + normQuote.length;
      }
    }
  }
  if (nStart === -1) {
    const q = locate(normFull, normQuote, 0);
    if (q === -1) return null;
    nStart = q;
    nEnd = q + normQuote.length;
  }
  if (normSuffix) {
    const s = locate(normFull, normSuffix, nEnd);
    if (s !== -1) {
      nEnd = s + normSuffix.length;
      // aralık genişletildi; alıntı aralığını korumak için tekrar quote konumuna dönüyoruz
      const q = locate(normFull.slice(nStart, nEnd), normQuote, 0);
      if (q !== -1) {
        nEnd = nStart + q + normQuote.length;
      }
    }
  }

  const start = map[nStart];
  const end = map[nEnd];
  if (start === undefined || end === undefined || end <= start) return null;
  return { start, end };
}

/** Seçimden alıntı + öncesi/sonrası bağlam üretir (normalize edilmiş). */
export function buildQuoteContext(
  fullText: string,
  start: number,
  end: number,
  contextLength = 60,
): { quote: string; prefix: string; suffix: string } {
  const quote = fullText.slice(start, end);
  const prefix = fullText.slice(Math.max(0, start - contextLength), start);
  const suffix = fullText.slice(end, end + contextLength);
  return { quote, prefix, suffix };
}

export function rangesOverlap(a: MatchedRange, b: MatchedRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Tek bir metin parçası içinde, normalize edilmiş eşleşmenin ham (orijinal)
 * karakter aralığını verir. Boşluk sıkıştırması geri sarılır.
 * Eşleşme parçanın dışına taşarsa null döner.
 */
export function rawSpanForNormalizedMatch(
  text: string,
  normStart: number,
  normLength: number,
): MatchedRange | null {
  const map: number[] = [];
  let ni = 0;
  let inWs = false;
  let started = false;
  for (let oi = 0; oi < text.length; oi++) {
    const isWs = /\s/.test(text[oi]);
    if (isWs && started) {
      if (!inWs) {
        map[ni++] = oi;
        inWs = true;
      }
      continue;
    }
    if (isWs) continue;
    inWs = false;
    map[ni] = oi;
    ni += 1;
    started = true;
  }
  map[ni] = text.length;
  const start = map[normStart];
  const end = map[normStart + normLength];
  if (start === undefined || end === undefined || end <= start) return null;
  return { start, end };
}
