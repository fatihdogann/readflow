import { describe, expect, it } from "vitest";
import { createTestDb } from "../testDb";
import { insertDocument, softDeleteDocument } from "./documents";
import { createAnnotation, listAllAnnotations } from "./annotations";

function seed() {
  const handle = createTestDb();
  const makale = insertDocument(handle.db, {
    title: "Altın rezervleri",
    sourceType: "url",
    sourceUrl: "https://ornek.com/altin",
    sourceDomain: "ornek.com",
    originalText: "uzun metin",
  });
  const not = insertDocument(handle.db, {
    title: "Kendi notum",
    sourceType: "text",
    originalText: "başka metin",
  });
  createAnnotation(handle.db, {
    documentId: makale.id,
    contentKind: "original",
    contentRevision: 0,
    quote: "merkez bankaları alım yapıyor",
    color: "yellow",
    note: "kontrol et",
  });
  createAnnotation(handle.db, {
    documentId: makale.id,
    contentKind: "original",
    contentRevision: 0,
    quote: "fiyatlar yükseldi",
    color: "green",
  });
  createAnnotation(handle.db, {
    documentId: not.id,
    contentKind: "original",
    contentRevision: 0,
    quote: "kendi cümlem",
    color: "lavender",
  });
  return { handle, makale, not };
}

describe("listAllAnnotations", () => {
  it("belge bilgisiyle birlikte, en yeniden eskiye döner", () => {
    const { handle, makale } = seed();
    try {
      const rows = listAllAnnotations(handle.db);
      expect(rows).toHaveLength(3);
      expect(rows[0].quote).toBe("kendi cümlem");
      const makaleVurgusu = rows.find((row) => row.document_id === makale.id)!;
      expect(makaleVurgusu.document_title).toBe("Altın rezervleri");
      expect(makaleVurgusu.document_domain).toBe("ornek.com");
      expect(makaleVurgusu.document_source_url).toBe("https://ornek.com/altin");
    } finally {
      handle.cleanup();
    }
  });

  it("renk, not ve metin filtreleri", () => {
    const { handle } = seed();
    try {
      expect(listAllAnnotations(handle.db, { color: "green" })).toHaveLength(1);
      expect(listAllAnnotations(handle.db, { withNote: true }).map((r) => r.note)).toEqual(["kontrol et"]);
      // Arama hem alıntıda hem notta çalışır
      expect(listAllAnnotations(handle.db, { q: "merkez" })).toHaveLength(1);
      expect(listAllAnnotations(handle.db, { q: "kontrol" })).toHaveLength(1);
      expect(listAllAnnotations(handle.db, { q: "bulunmayan" })).toHaveLength(0);
    } finally {
      handle.cleanup();
    }
  });

  it("çöpteki belgenin vurguları listelenmez", () => {
    const { handle, makale } = seed();
    try {
      softDeleteDocument(handle.db, makale.id);
      const rows = listAllAnnotations(handle.db);
      expect(rows).toHaveLength(1);
      expect(rows[0].document_title).toBe("Kendi notum");
    } finally {
      handle.cleanup();
    }
  });

  it("LIKE joker karakterleri düz metin olarak aranır", () => {
    const { handle, not } = seed();
    try {
      createAnnotation(handle.db, {
        documentId: not.id,
        contentKind: "original",
        contentRevision: 0,
        quote: "%100 kesin",
        color: "yellow",
      });
      expect(listAllAnnotations(handle.db, { q: "%100" })).toHaveLength(1);
      // Tek başına "%" her şeyi getirmemeli
      expect(listAllAnnotations(handle.db, { q: "%" })).toHaveLength(1);
    } finally {
      handle.cleanup();
    }
  });
});
