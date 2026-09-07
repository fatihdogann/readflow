import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { detectKind, extractFromBuffer } from "./fromBuffer";
import { InputError } from "../types";

const fixture = (name: string): Buffer =>
  fs.readFileSync(path.join(__dirname, "__fixtures__", name));

describe("detectKind (imzadan tür tespiti)", () => {
  it("PDF ve DOCX'i içerik imzasından tanır — uzantıya güvenmez", () => {
    expect(detectKind(fixture("sample.pdf"), "", "yanlis-ad.txt")).toBe("pdf");
    expect(detectKind(fixture("sample.docx"), "", "yanlis-ad.txt")).toBe("docx");
  });

  it("düz metni content-type veya uzantıdan tanır", () => {
    expect(detectKind(Buffer.from("merhaba"), "text/plain", "")).toBe("text");
    expect(detectKind(Buffer.from("# başlık"), "", "not.md")).toBe("text");
  });

  it("tanınmayan ikili içerik null döner", () => {
    expect(detectKind(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png", "resim.png")).toBeNull();
  });
});

describe("extractFromBuffer", () => {
  it("PDF metnini çıkarır", async () => {
    const result = await extractFromBuffer(fixture("sample.pdf"), { fileName: "sample.pdf" });
    expect(result.originalText).toContain("Readflow PDF cikarim testi");
    expect(result.originalText).toContain("Ikinci satir");
    expect(result.domain).toBe("pdf");
  });

  it("DOCX'i başlık + Türkçe metin + sanitize HTML olarak çıkarır", async () => {
    const result = await extractFromBuffer(fixture("sample.docx"), { fileName: "sample.docx" });
    expect(result.title).toBe("Readflow Word Testi");
    expect(result.originalText).toContain("ğüşiöç ĞÜŞİÖÇ");
    expect(result.originalHtml).toContain("<h1>");
    // Sanitize edilmiş olmalı: script kalmamalı
    expect(result.originalHtml).not.toMatch(/<script/i);
  });

  it("düz metin dosyasını olduğu gibi alır", async () => {
    const result = await extractFromBuffer(Buffer.from("# Not\n\nİçerik burada."), {
      contentType: "text/markdown",
      fileName: "not.md",
      label: "not",
    });
    expect(result.originalText).toContain("İçerik burada.");
    expect(result.title).toBe("not");
  });

  it("desteklenmeyen türde anlamlı hata verir", async () => {
    await expect(
      extractFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { contentType: "image/png" }),
    ).rejects.toThrow(InputError);
  });

  it("boş dosyayı reddeder", async () => {
    await expect(
      extractFromBuffer(Buffer.from(""), { contentType: "text/plain", fileName: "bos.txt" }),
    ).rejects.toThrow(/boş/i);
  });
});
