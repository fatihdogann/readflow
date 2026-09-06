import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/testDb";
import { createDocumentFromInput, getDocumentDetail, titleFromText } from "./service";
import { listDocuments, updateNote } from "../db/repo/documents";
import { createJob } from "../db/repo/jobs";
import { InputError, looksLikeUrl } from "../types";

describe("looksLikeUrl", () => {
  it("url'yi metinden ayırır", () => {
    expect(looksLikeUrl("https://example.com/yazi?a=1")).toBe(true);
    expect(looksLikeUrl("http://example.com")).toBe(true);
    expect(looksLikeUrl("https:// example")).toBe(false);
    expect(looksLikeUrl("Bugün hava çok güzel. https olsa da olmasa da metindir.")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
  });
});

describe("titleFromText", () => {
  it("ilk satırdan başlık üretir ve kısaltır", () => {
    expect(titleFromText("İlk satır başlık\n\ngövde")).toBe("İlk satır başlık");
    expect(titleFromText("x".repeat(200)).length).toBeLessThanOrEqual(80);
    expect(titleFromText("   \n  ")).toBe("Adsız metin");
    expect(titleFromText("gövde", "Verilen Başlık")).toBe("Verilen Başlık");
  });
});

describe("createDocumentFromInput", () => {
  it("metin dokümanı oluşturur", async () => {
    const handle = createTestDb();
    try {
      const doc = await createDocumentFromInput(handle.db, {
        text: "Başlık Satırı\n\nBir paragraf more.",
      });
      expect(doc.source_type).toBe("text");
      expect(doc.title).toBe("Başlık Satırı");
      expect(doc.source_url).toBeNull();
    } finally {
      handle.cleanup();
    }
  });

  it("ne url ne metin verilirse hata verir", async () => {
    const handle = createTestDb();
    try {
      await expect(createDocumentFromInput(handle.db, {})).rejects.toThrow(InputError);
    } finally {
      handle.cleanup();
    }
  });

  it("geçersiz url'yi reddeder (ağ kurulumu olmadan)", async () => {
    const handle = createTestDb();
    try {
      await expect(
        createDocumentFromInput(handle.db, { url: "http://127.0.0.1:8080/secret" }),
      ).rejects.toThrow(InputError);
      await expect(
        createDocumentFromInput(handle.db, { url: "not-a-url" }),
      ).rejects.toThrow(InputError);
    } finally {
      handle.cleanup();
    }
  });
});

describe("getDocumentDetail + FTS arama", () => {
  it("kişisel notu kaydeder, günceller ve boşaltınca zaman damgasını sıfırlar", async () => {
    const handle = createTestDb();
    try {
      const doc = await createDocumentFromInput(handle.db, { text: "Not Testi\n\ngövde" });
      expect(getDocumentDetail(handle.db, doc.id)?.document.note).toBe("");

      updateNote(handle.db, doc.id, "Önemli: veriler 2026'dan.");
      const withNote = getDocumentDetail(handle.db, doc.id)!.document;
      expect(withNote.note).toBe("Önemli: veriler 2026'dan.");
      expect(withNote.note_updated_at).toBeTruthy();

      updateNote(handle.db, doc.id, "   ");
      const cleared = getDocumentDetail(handle.db, doc.id)!.document;
      expect(cleared.note).toBe("");
      expect(cleared.note_updated_at).toBeNull();
    } finally {
      handle.cleanup();
    }
  });

  it("detay dokümanı, çıktıları ve job'ları birleştirir", async () => {
    const handle = createTestDb();
    try {
      const doc = await createDocumentFromInput(handle.db, { text: "Arama Testi\n\niçerik" });
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      const detail = getDocumentDetail(handle.db, doc.id);
      expect(detail?.document.title).toBe("Arama Testi");
      expect(detail?.jobs).toHaveLength(1);
      expect(detail?.tags).toEqual([]);
      expect(getDocumentDetail(handle.db, 9999)).toBeNull();
    } finally {
      handle.cleanup();
    }
  });

  it("tam metin araması başlık ve gövdede bulur", async () => {
    const handle = createTestDb();
    try {
      await createDocumentFromInput(handle.db, {
        text: "Kuantum Bilgisayarlar\n\nKıvamında bir metin: kubit nedir?",
      });
      await createDocumentFromInput(handle.db, {
        text: "Bahçe Bakımı\n\nGül nasıl budanır?",
      });

      const quantum = listDocuments(handle.db, { q: "kubit" });
      expect(quantum).toHaveLength(1);
      expect(quantum[0].title).toBe("Kuantum Bilgisayarlar");

      const budama = listDocuments(handle.db, { q: "budanır" });
      expect(budama).toHaveLength(1);
      expect(budama[0].title).toBe("Bahçe Bakımı");

      // prefix arama
      const prefix = listDocuments(handle.db, { q: "kuant" });
      expect(prefix).toHaveLength(1);

      expect(listDocuments(handle.db, { q: "yok-öle-bir" })).toHaveLength(0);
    } finally {
      handle.cleanup();
    }
  });
});
