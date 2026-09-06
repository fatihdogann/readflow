import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { InputError } from "../types";
import { sanitizeArticleHtml } from "./sanitize";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;
const MAX_HTML_CHARS = 3_000_000;
const MAX_REDIRECTS = 4;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Readflow/0.1 Safari/537.36";

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

export async function fetchArticle(rawUrl: string): Promise<ArticleExtraction> {
  let url = assertPublicHttpUrl(rawUrl);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    assertPublicHttpUrl(url.href);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        },
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
      throw new InputError(`Sayfa indirilemedi (HTTP ${response.status})`);
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
      throw new InputError(`Desteklenmeyen içerik türü: ${contentType || "bilinmiyor"}`);
    }
    const html = await readBodyCapped(response);
    return extractFromHtml(html, url.href);
  }
  throw new InputError("Çok fazla yönlendirme");
}

function firstLine(text: string, max = 120): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
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
    author: firstLine(article?.byline ?? "", 200) || null,
    publishedAt: article?.publishedTime ?? null,
    originalText: originalText.slice(0, MAX_TEXT_CHARS),
    originalHtml: sanitized ? sanitized.slice(0, MAX_HTML_CHARS) : null,
    domain: new URL(baseUrl).hostname,
  };
}
