import dns from "node:dns/promises";
import net from "node:net";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { formatAuthorByline } from "../text/author";
import { InputError } from "../types";
import { sanitizeArticleHtml } from "./sanitize";
import { extractFromBuffer } from "./fromBuffer";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** PDF/Word gövdeleri HTML'den çok daha büyük olabilir. */
const MAX_BINARY_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;
const MAX_HTML_CHARS = 3_000_000;
const MAX_REDIRECTS = 4;
// Bot korumaları bilinmeyen UA token'ına (eski "Readflow/0.1") 403 basıyordu.
// Tarayıcının kendi imzası kullanılır; kimlik gizleme değil, engellenmemek için.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const REQUEST_HEADERS: Record<string, string> = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "upgrade-insecure-requests": "1",
};

export interface ArticleExtraction {
  title: string;
  author: string | null;
  publishedAt: string | null;
  originalText: string;
  originalHtml: string | null;
  domain: string;
}

/** Yalnızca http(s) ve genel ağ adresleri kabul edilir (SSRF yüzeyini kısar). */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InputError("Geçersiz URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InputError("Yalnızca http ve https adresleri desteklenir");
  }
  if (url.username || url.password) {
    throw new InputError("Kullanıcı bilgisi içeren adresler desteklenmez");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    throw new InputError("Yerel ve ağ içi adresler desteklenmez");
  }
  const hostParts = host.split(".");
  if (hostParts[0] === "172" && hostParts.length >= 3) {
    const secondOctet = Number(hostParts[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      throw new InputError("Yerel ve ağ içi adresler desteklenmez");
    }
  }
  return url;
}

/** Özel/yerel ağ adresi mi (IPv4 + IPv6 + IPv4-mapped IPv6). */
export function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice(7));
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    );
  }
  if (net.isIPv6(ip)) {
    return (
      ip === "::" ||
      ip === "::1" ||
      ip.startsWith("fc") || // unique local
      ip.startsWith("fd") ||
      ip.startsWith("fe8") || // link local
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb") ||
      ip.startsWith("ff") // multicast
    );
  }
  return false;
}

/**
 * Hostname'i çözer ve dönen TÜM adreslerin genel ağda olduğunu doğrular.
 * Yalnızca hostname string'ine bakmak DNS rebinding'i durdurmaz: saldırgan
 * kendi alan adını 127.0.0.1'e yönlendirebilir.
 *
 * ponytail: çözümleme ile fetch arasında TOCTOU penceresi kalır (Node fetch
 * bağlanacağı IP'yi dışarı vermiyor). Kapatmak için özel bir agent/lookup
 * gerekir — trafik artarsa oraya geçilir.
 */
async function assertResolvesToPublicIp(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new InputError("Yerel ve ağ içi adresler desteklenmez");
    return;
  }
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new InputError("Alan adı çözümlenemedi");
  }
  if (records.length === 0) throw new InputError("Alan adı çözümlenemedi");
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new InputError("Yerel ve ağ içi adresler desteklenmez");
  }
}

/** Gövdeyi ikili olarak, sınırı aşmadan okur (PDF/Word yolu). */
async function readBinaryCapped(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > limit) throw new InputError("Dosya çok büyük");
    return Buffer.from(buffer);
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new InputError(`Dosya çok büyük (sınır: ${Math.round(limit / 1024 / 1024)} MB)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readBodyCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new InputError("İçerik çok büyük (sınır: 5 MB)");
    }
    return Buffer.from(buffer).toString("utf8");
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new InputError("İçerik çok büyük (sınır: 5 MB)");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/** Sitenin bizi engellediği durumlar: yedek yollar denenmeye değer. */
export class BlockedError extends InputError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Adresi indirip doküman çıkarır. Site bizi engellerse (401/403/429) sırayla
 * yedek yollar denenir; hepsi başarısızsa sitenin kendi hatası fırlatılır ve
 * kullanıcıya "HTML'i kendin yapıştır" kaçış yolu kalır.
 */
export async function fetchArticle(rawUrl: string): Promise<ArticleExtraction> {
  const url = assertPublicHttpUrl(rawUrl);
  try {
    return await fetchAndExtract(url);
  } catch (error) {
    if (!(error instanceof BlockedError)) throw error;
    const archived = await tryWaybackSnapshot(url);
    if (archived) return archived;
    throw error;
  }
}

/**
 * Wayback Machine'de erişilebilir bir kopya varsa oradan çıkarır.
 * Başarısızlık sessizdir: yedek yol, asıl hatanın yerine geçmemeli.
 */
async function tryWaybackSnapshot(url: URL): Promise<ArticleExtraction | null> {
  try {
    const lookup = new URL("https://archive.org/wayback/available");
    lookup.searchParams.set("url", url.href);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let snapshotUrl: string | null = null;
    try {
      const response = await fetch(lookup.href, {
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        archived_snapshots?: { closest?: { available?: boolean; url?: string } };
      };
      const closest = body.archived_snapshots?.closest;
      if (closest?.available && closest.url) snapshotUrl = closest.url;
    } finally {
      clearTimeout(timer);
    }
    if (!snapshotUrl) return null;

    const article = await fetchAndExtract(assertPublicHttpUrl(snapshotUrl.replace(/^http:/, "https:")));
    // Arşivden gelse de belge kullanıcının verdiği adrese ait sayılır.
    return { ...article, domain: url.hostname };
  } catch {
    return null;
  }
}

async function fetchAndExtract(startUrl: URL): Promise<ArticleExtraction> {
  let url = startUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    assertPublicHttpUrl(url.href);
    // Hostname allowlist'i yetmez: gerçekte hangi IP'ye gittiğini de doğrula.
    await assertResolvesToPublicIp(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.href, {
        redirect: "manual",
        signal: controller.signal,
        // Referer yalnızca kendi origin'i: bazı siteler doğrudan girişi bot sayıyor.
        headers: { ...REQUEST_HEADERS, referer: url.origin + "/" },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new InputError("Sayfa zaman aşımına uğradı");
      }
      throw new InputError("Sayfaya erişilemedi (ağ hatası)");
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new InputError("Yönlendirme başarısız");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        throw new BlockedError(describeHttpFailure(response.status), response.status);
      }
      throw new InputError(describeHttpFailure(response.status));
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("text/plain")) {
      const text = (await readBodyCapped(response)).trim();
      if (!text) throw new InputError("Sayfa boş görünüyor");
      const domain = url.hostname;
      const label = url.pathname === "/" ? domain : decodeURIComponent(url.pathname);
      return {
        title: firstLine(label) || domain,
        author: null,
        publishedAt: null,
        originalText: text.slice(0, MAX_TEXT_CHARS),
        originalHtml: null,
        domain,
      };
    }
    if (!/text\/html|application\/xhtml\+xml/.test(contentType)) {
      // PDF / Word / Markdown gibi dosyalar: imzasından tanınıp metne çevrilir.
      const buffer = await readBinaryCapped(response, MAX_BINARY_BYTES);
      const fileName = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const extraction = await extractFromBuffer(buffer, {
        contentType,
        fileName,
        label: fileName.replace(/\.[^.]+$/, "") || url.hostname,
      });
      // Kaynak adresten gelen dosyada alan adı korunsun (arşiv filtreleri için).
      return { ...extraction, domain: url.hostname };
    }
    const html = await readBodyCapped(response);
    return extractFromHtml(html, url.href);
  }
  throw new InputError("Çok fazla yönlendirme");
}

/** HTTP hatasını kullanıcının ne yapacağını anlayacağı şekilde açıklar. */
function describeHttpFailure(status: number): string {
  if (status === 401 || status === 403) {
    return `Site isteği reddetti (HTTP ${status}) — bot koruması veya oturum gerekiyor. Arşiv kopyası da bulunamadı; sayfanın HTML'ini yapıştırarak ekleyebilirsin.`;
  }
  if (status === 404 || status === 410) return `Sayfa bulunamadı (HTTP ${status})`;
  if (status === 429) return "Site çok fazla istek gördü (HTTP 429) — biraz sonra tekrar dene veya sayfanın HTML'ini yapıştır";
  if (status >= 500) return `Sitenin sunucusu hata verdi (HTTP ${status})`;
  return `Sayfa indirilemedi (HTTP ${status})`;
}

function firstLine(text: string, max = 120): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const MAX_IMAGES = 10;

/**
 * Sanitize edilmiş makale HTML'inden mutlak görsel adreslerini çıkarır.
 * İş anında snapshot'a yazılır; AI yalnızca bu adresleri kullanabilir.
 */
export function extractImageUrls(sanitizedHtml: string | null, max = MAX_IMAGES): string[] {
  if (!sanitizedHtml) return [];
  const urls: string[] = [];
  const pattern = /<img\s[^>]*src="(https?:\/\/[^"]+)"/g;
  for (const match of sanitizedHtml.matchAll(pattern)) {
    const url = match[1];
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= max) break;
  }
  return urls;
}

/** JSDOM + Readability ile ana makaleyi çıkarır; HTML'i sanitize eder. */
export function extractFromHtml(html: string, baseUrl: string): ArticleExtraction {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  // Görsel adreslerini mutlaklaştır; srcset'i temizle.
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (src) {
      try {
        const absolute = new URL(src, baseUrl);
        if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
          img.removeAttribute("src");
        } else {
          img.setAttribute("src", absolute.href);
        }
      } catch {
        img.removeAttribute("src");
      }
    }
    img.removeAttribute("srcset");
  }

  const pageTitle = (doc.title ?? "").trim();
  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(doc.cloneNode(true) as Document).parse();
  } catch {
    article = null;
  }

  // Başlık olarak makale manşetini (h1) tercih et; <title> genelde site adını da taşır.
  const headline =
    doc.querySelector("article h1")?.textContent ??
    doc.querySelector("main h1")?.textContent ??
    doc.querySelector("h1")?.textContent ??
    "";
  const headlineClean = headline.replace(/\s+/g, " ").trim();

  const fallbackText = (doc.body?.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const originalText = (article?.textContent ?? fallbackText)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (originalText.length < 30) {
    throw new InputError("Sayfada okunabilir makale içeriği bulunamadı");
  }

  const rawContentHtml = typeof article?.content === "string" ? article.content : null;
  const sanitized = rawContentHtml ? sanitizeArticleHtml(rawContentHtml) : null;

  return {
    title: firstLine(headlineClean || article?.title || pageTitle || "Adsız sayfa", 300),
    author: formatAuthorByline(firstLine(article?.byline ?? "", 200)) || null,
    publishedAt: article?.publishedTime ?? null,
    originalText: originalText.slice(0, MAX_TEXT_CHARS),
    originalHtml: sanitized ? sanitized.slice(0, MAX_HTML_CHARS) : null,
    domain: new URL(baseUrl).hostname,
  };
}
