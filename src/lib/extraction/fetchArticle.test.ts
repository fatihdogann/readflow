import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assertPublicHttpUrl, extractFromHtml, extractImageUrls, isPrivateIp } from "./fetchArticle";
import { textToSafeHtml } from "./sanitize";
import { InputError } from "../types";

const fixture = fs.readFileSync(path.join(__dirname, "__fixtures__", "sample-article.html"), "utf8");

describe("assertPublicHttpUrl", () => {
  it("geçerli https adresini kabul eder", () => {
    expect(assertPublicHttpUrl("https://example.com/yazi")?.hostname).toBe("example.com");
  });

  it("http/https dışını reddeder", () => {
    expect(() => assertPublicHttpUrl("ftp://example.com/dosya")).toThrow(InputError);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(InputError);
  });

  it("yerel ve özel ağ adreslerini reddeder", () => {
    for (const bad of [
      "http://localhost:3000",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.10/x",
      "http://169.254.1.1/x",
      "http://172.16.0.1/x",
      "http://makine.local/x",
    ]) {
      expect(() => assertPublicHttpUrl(bad)).toThrow(InputError);
    }
    // 172.31 özel, 172.32 genele açık aralık
    expect(() => assertPublicHttpUrl("http://172.31.0.1/x")).toThrow(InputError);
    expect(assertPublicHttpUrl("http://172.32.0.1/x").hostname).toBe("172.32.0.1");
  });

  it("kullanıcı bilgisi içeren adresleri reddeder", () => {
    expect(() => assertPublicHttpUrl("https://user:pass@example.com/")).toThrow(InputError);
  });
});

describe("extractFromHtml", () => {
  const result = extractFromHtml(fixture, "https://orneksite.com/blog/yapay-zeka-bellek");

  it("başlık, yazar ve yayın tarihini çıkarır", () => {
    expect(result.title).toContain("Yapay Zeka ve Uzun Vadeli Bellek");
    expect(result.author).toContain("Ayşe Yılmaz");
    expect(result.publishedAt).toContain("2026-08-15");
    expect(result.domain).toBe("orneksite.com");
  });

  it("ana makale metnini çıkarır ve gürültüyü azaltır", () => {
    expect(result.originalText).toContain("uzun vadeli bellek");
    expect(result.originalText).toContain("0.002");
    expect(result.originalText).not.toContain("Reklam içeriği");
    expect(result.originalText).not.toContain("Tüm hakları saklıdır");
  });

  it("html'i sanitize eder: script yok, görsel adresi mutlak", () => {
    expect(result.originalHtml).toBeTruthy();
    expect(result.originalHtml).not.toContain("<script");
    expect(result.originalHtml).not.toContain("trackerId");
    expect(result.originalHtml).toContain('src="https://orneksite.com/images/bellek.png"');
    expect(result.originalHtml).not.toContain("srcset");
  });
});

describe("textToSafeHtml", () => {
  it("HTML'i kaçırır ve paragraflara böler", () => {
    const html = textToSafeHtml("<script>x</script>\n\nikinci paragraf");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<p>ikinci paragraf</p>");
  });
});

describe("extractImageUrls", () => {
  it("sanitize edilmiş HTML'den mutlak görsel adreslerini sırayla çıkarır", () => {
    const html =
      '<p><img src="https://ornek.com/a.png" alt="a"></p><img src="https://ornek.com/b.png"><img src="https://ornek.com/a.png">';
    expect(extractImageUrls(html)).toEqual(["https://ornek.com/a.png", "https://ornek.com/b.png"]);
    expect(extractImageUrls(null)).toEqual([]);
    // Görsel adresi olmayan relatif src düşer
    expect(extractImageUrls('<img src="/relatif.png">')).toEqual([]);
  });
});

describe("isPrivateIp (DNS rebinding koruması)", () => {
  it("özel ve yerel adresleri yakalar", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it("genel adresleri geçirir", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});
