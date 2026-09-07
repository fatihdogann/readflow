import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { openDatabase } from "./connection";
import { createTestDb } from "./testDb";
import {
  insertDocument,
  getDocument,
  listDocuments,
  searchDocuments,
  softDeleteDocument,
  restoreDocument,
  countDocuments,
} from "./repo/documents";
import { createFolder } from "./repo/folders";
import { setDocumentTags, listDocumentTags } from "./repo/tags";
import { upsertOutput } from "./repo/outputs";
import { listProfiles, getDefaultProfileId, updateProfile } from "./repo/agentProfiles";
import { orderedFallbackConfigs } from "../agent/profiles";

describe("migrations", () => {
  it("şemayı kurar ve ikinci açılışta migration tekrar çalışmaz", () => {
    const handle = createTestDb();
    try {
      const tables = handle.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      for (const expected of ["documents", "document_outputs", "jobs", "folders", "tags", "document_tags"]) {
        expect(names).toContain(expected);
      }
      // Aynı dosyayı ikinci bağlantı ile açmak sorunsuz olmalı
      const db2 = openDatabase(handle.dataDir);
      const row = db2.prepare(`SELECT COUNT(*) AS c FROM documents`).get() as { c: number };
      expect(row.c).toBe(0);
      db2.close();
    } finally {
      handle.cleanup();
    }
  });

  it("varsayılan failover zinciri jcode → codex → claude sırasıyla kurulur", () => {
    const handle = createTestDb();
    try {
      const profiles = listProfiles(handle.db);
      expect(profiles.map((profile) => profile.cli)).toEqual(["jcode", "codex", "claude"]);
      expect(profiles[0].model).toBe("glm-5.3-flash");
      expect(profiles[1].model).toBe("gpt-5.6-terra");
      expect(profiles[2].model).toBe("opus-5");
      // jcode effort bayrağı yok: değer saklanmaz
      expect(profiles[0].effort).toBeNull();
      expect(profiles[1].effort).toBe("medium");
      expect(profiles[2].effort).toBe("medium");
      // Zincirin başı varsayılan profil olur
      expect(getDefaultProfileId(handle.db)).toBe(profiles[0].id);
    } finally {
      handle.cleanup();
    }
  });

  it("yedek zinciri birincil CLI'ı atlar ve priority sırasını korur", () => {
    const handle = createTestDb();
    try {
      const profiles = listProfiles(handle.db);
      const fallbacks = orderedFallbackConfigs(profiles, "jcode");
      expect(fallbacks.map((config) => config.cli)).toEqual(["codex", "claude"]);
      // Devre dışı profil zincire girmez
      updateProfile(handle.db, profiles[1].id, { enabled: false });
      expect(orderedFallbackConfigs(listProfiles(handle.db), "jcode").map((c) => c.cli)).toEqual(["claude"]);
    } finally {
      handle.cleanup();
    }
  });

  it("soft delete: doküman listeden düşer, geri alınca geri gelir", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, {
        title: "Silinecek",
        sourceType: "text",
        originalText: "geri alınabilir silme testi",
      });
      expect(softDeleteDocument(handle.db, doc.id)).toBe(true);
      expect(getDocument(handle.db, doc.id)).toBeNull();
      expect(listDocuments(handle.db).some((item) => item.id === doc.id)).toBe(false);
      expect(searchDocuments(handle.db, { q: "geri alınabilir" }).some((hit) => hit.id === doc.id)).toBe(false);
      expect(countDocuments(handle.db)).toBe(0);
      // Aynı silme iki kez uygulanmaz
      expect(softDeleteDocument(handle.db, doc.id)).toBe(false);

      expect(restoreDocument(handle.db, doc.id)).toBe(true);
      expect(getDocument(handle.db, doc.id)?.title).toBe("Silinecek");
      expect(listDocuments(handle.db).some((item) => item.id === doc.id)).toBe(true);
      expect(restoreDocument(handle.db, doc.id)).toBe(false);
    } finally {
      handle.cleanup();
    }
  });

  it("veriler bağlantı kapanıp açıldıktan sonra da kalıcıdır", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, {
        title: "Kalıcılık testi",
        sourceType: "text",
        originalText: "Bu metin restart sonrasında da durmalı.",
      });
      handle.db.close();
      const reopened = openDatabase(handle.dataDir);
      const loaded = getDocument(reopened, doc.id);
      expect(loaded?.title).toBe("Kalıcılık testi");
      reopened.close();
    } finally {
      fs.rmSync(handle.dataDir, { recursive: true, force: true });
    }
  });
});

describe("documents repo", () => {
  it("url ve metin dokümanlarını kaydeder ve listeler", () => {
    const handle = createTestDb();
    try {
      insertDocument(handle.db, {
        title: "A",
        sourceType: "url",
        sourceUrl: "https://example.com/a",
        sourceDomain: "example.com",
        originalText: "içerik a",
      });
      insertDocument(handle.db, {
        title: "B",
        sourceType: "text",
        originalText: "içerik b",
      });
      const docs = listDocuments(handle.db);
      expect(docs).toHaveLength(2);
      expect(docs[0].title).toBe("B"); // en yeni önce
      const domains = listDocuments(handle.db, { domain: "example.com" });
      expect(domains.map((d) => d.title)).toEqual(["A"]);
    } finally {
      handle.cleanup();
    }
  });

  it("klasör silinince doküman klasörsüz kalır (FK ON DELETE SET NULL)", () => {
    const handle = createTestDb();
    try {
      const folder = createFolder(handle.db, "Okunanlar");
      const doc = insertDocument(handle.db, {
        title: "T",
        sourceType: "text",
        originalText: "metin",
        folderId: folder.id,
      });
      handle.db.prepare(`DELETE FROM folders WHERE id = ?`).run(folder.id);
      expect(getDocument(handle.db, doc.id)?.folder_id).toBeNull();
    } finally {
      handle.cleanup();
    }
  });

  it("etiketler many-to-many çalışır ve boş listeye düşürür", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      setDocumentTags(handle.db, doc.id, ["yapay-zeka", "notlar"]);
      expect(listDocumentTags(handle.db, doc.id).sort()).toEqual(["notlar", "yapay-zeka"]);
      setDocumentTags(handle.db, doc.id, ["yapay-zeka"]);
      expect(listDocumentTags(handle.db, doc.id)).toEqual(["yapay-zeka"]);
    } finally {
      handle.cleanup();
    }
  });

  it("aynı dokümana aynı operasyon için upsert tek satır üretir", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      upsertOutput(handle.db, {
        documentId: doc.id,
        operation: "readability",
        summaryLevel: "",
        content: "v1",
      });
      upsertOutput(handle.db, {
        documentId: doc.id,
        operation: "readability",
        summaryLevel: "",
        content: "v2",
      });
      const rows = handle.db
        .prepare(`SELECT content FROM document_outputs WHERE document_id = ?`)
        .all(doc.id) as Array<{ content: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe("v2");
    } finally {
      handle.cleanup();
    }
  });
});
