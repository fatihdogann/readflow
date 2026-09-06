import { describe, expect, it } from "vitest";
import { createTestDb } from "../../db/testDb";
import { insertDocument } from "./documents";
import { getEdit, saveEdit, deleteEdit } from "./documentEdits";
import { getDocumentDetail } from "../../documents/service";

describe("document_edits", () => {
  it("yoksa oluşturur, revision artırır ve optimistic concurrency uygular", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "orijinal" });
      expect(getEdit(handle.db, doc.id)).toBeNull();

      const first = saveEdit(handle.db, doc.id, "ilk sürüm", 0);
      expect(first.applied).toBe(true);
      expect(first.edit.revision).toBe(1);

      // Eski revision ile kayıt çakışır, taslak istemcide kalır (applied=false)
      const conflict = saveEdit(handle.db, doc.id, "bayat taslak", 0);
      expect(conflict.applied).toBe(false);
      expect(conflict.edit.revision).toBe(1);
      expect(conflict.edit.content).toBe("ilk sürüm");

      // Doğru revision ile güncellenir
      const second = saveEdit(handle.db, doc.id, "ikinci sürüm", 1);
      expect(second.applied).toBe(true);
      expect(second.edit.revision).toBe(2);

      // Orijinal asla değişmez
      expect(handle.db.prepare(`SELECT original_text FROM documents WHERE id = ?`).get(doc.id))
        .toMatchObject({ original_text: "orijinal" });

      expect(deleteEdit(handle.db, doc.id)).toBe(true);
      expect(getEdit(handle.db, doc.id)).toBeNull();
    } finally {
      handle.cleanup();
    }
  });

  it("detay servisi edit bilgisini döndürür", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      expect(getDocumentDetail(handle.db, doc.id)?.edit).toBeNull();
      saveEdit(handle.db, doc.id, "düzenlenmiş", 0);
      const detail = getDocumentDetail(handle.db, doc.id);
      expect(detail?.edit?.content).toBe("düzenlenmiş");
      expect(detail?.edit?.revision).toBe(1);
    } finally {
      handle.cleanup();
    }
  });

  it("düzenleme satırı kimliği belge kimliğinden farklı olsa da yeni sürümü döndürür", () => {
    const handle = createTestDb();
    try {
      insertDocument(handle.db, { title: "İlk", sourceType: "text", originalText: "ilk" });
      const document = insertDocument(handle.db, {
        title: "İkinci",
        sourceType: "text",
        originalText: "ikinci",
      });

      const outcome = saveEdit(handle.db, document.id, "ikinci belgenin düzenlemesi", 0);

      expect(outcome.applied).toBe(true);
      expect(outcome.edit).toMatchObject({
        document_id: document.id,
        content: "ikinci belgenin düzenlemesi",
        revision: 1,
      });
    } finally {
      handle.cleanup();
    }
  });
});
