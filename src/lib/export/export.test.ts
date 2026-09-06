import { describe, expect, it } from "vitest";
import { buildDocxBuffer } from "./docx";
import { buildMarkdown, buildTxt, slugify } from "./format";
import { NotionExporter } from "./notion";
import { TelegramExporter } from "./telegram";
import type { ExportPayload } from "./types";

const payload: ExportPayload = {
  document: {
    id: 1,
    title: "Örnek Yazı",
    source_type: "url",
    source_url: "https://example.com/yazi",
    source_domain: "example.com",
    author: "Ayşe Yılmaz",
    published_at: "2026-08-15T09:00:00Z",
    original_text: "orijinal metin",
    original_html: "<p>orijinal metin</p>",
    favorite: 0,
    folder_id: null,
    note: "",
    note_updated_at: null,
    created_at: "2026-09-06T10:00:00.000Z",
    updated_at: "2026-09-06T10:00:00.000Z",
  },
  output: {
    id: 10,
    document_id: 1,
    operation: "summary",
    summary_level: "normal",
    content: "## Özet\n\n- Birinci madde",
    agent_name: "mock",
    agent_metadata: null,
    created_at: "2026-09-06T10:01:00.000Z",
    updated_at: "2026-09-06T10:01:00.000Z",
  },
};

describe("format", () => {
  it("markdown çıktısı başlık, meta ve içeriği birleştirir", () => {
    const md = buildMarkdown(payload);
    expect(md).toContain("# Örnek Yazı");
    expect(md).toContain("https://example.com/yazi");
    expect(md).toContain("Özet (Normal)");
    expect(md).toContain("## Özet");
    expect(md).toContain("- Birinci madde");
  });

  it("txt çıktısı orijinal için de çalışır", () => {
    const txt = buildTxt({ ...payload, output: null });
    expect(txt).toContain("ÖRNEK YAZI");
    expect(txt).toContain("orijinal metin");
  });

  it("slugify Türkçe karakterleri sadeleştirir", () => {
    expect(slugify("Örnek Çağrı: ŞİMDİ!")).toBe("ornek-cagri-simdi");
  });

  it("boş not exportlara girmez, dolu not bölüm olarak eklenir", () => {
    expect(buildMarkdown(payload)).not.toContain("Kişisel Not");
    const withNote = {
      ...payload,
      document: { ...payload.document, note: "Fiyat verisi 2026'ya ait, teyit et." },
    };
    const md = buildMarkdown(withNote);
    expect(md).toContain("## Kişisel Not");
    expect(md).toContain("teyit et");
    expect(buildTxt(withNote)).toContain("KIŞISEL NOT");
  });
});

describe("docx", () => {
  it("gerçek bir OOXML paketi üretir (zip magic: PK)", async () => {
    const buffer = await buildDocxBuffer(payload);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("uzak entegrasyonlar", () => {
  it("credential yoksa yapılandırılmamış der ve uygulamayı bozmaz", async () => {
    const saved = { notion: process.env.READFLOW_NOTION_TOKEN, telegram: process.env.READFLOW_TELEGRAM_BOT_TOKEN };
    delete process.env.READFLOW_NOTION_TOKEN;
    delete process.env.READFLOW_NOTION_DATABASE_ID;
    delete process.env.READFLOW_TELEGRAM_BOT_TOKEN;
    delete process.env.READFLOW_TELEGRAM_CHAT_ID;
    try {
      const notion = new NotionExporter();
      expect(notion.isConfigured()).toBe(false);
      expect(notion.missingConfig()).toContain("READFLOW_NOTION_TOKEN");
      const notionResult = await notion.export(payload);
      expect(notionResult.ok).toBe(false);
      expect(notionResult.message).toContain("READFLOW_NOTION_TOKEN");

      const telegram = new TelegramExporter();
      expect(telegram.isConfigured()).toBe(false);
      const telegramResult = await telegram.export(payload);
      expect(telegramResult.ok).toBe(false);
    } finally {
      if (saved.notion !== undefined) process.env.READFLOW_NOTION_TOKEN = saved.notion;
      if (saved.telegram !== undefined) process.env.READFLOW_TELEGRAM_BOT_TOKEN = saved.telegram;
    }
  });

  it("geçersiz token biçiminde göndermeden önce reddeder", async () => {
    process.env.READFLOW_TELEGRAM_BOT_TOKEN = "bad token with spaces";
    process.env.READFLOW_TELEGRAM_CHAT_ID = "123";
    try {
      const telegram = new TelegramExporter();
      expect(telegram.isConfigured()).toBe(true);
      const result = await telegram.export(payload);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("beklenmeyen karakter");
    } finally {
      delete process.env.READFLOW_TELEGRAM_BOT_TOKEN;
      delete process.env.READFLOW_TELEGRAM_CHAT_ID;
    }
  });
});
