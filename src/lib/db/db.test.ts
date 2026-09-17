import { describe, expect, it, vi } from "vitest";
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
  setReadState,
} from "./repo/documents";
import { createFolder } from "./repo/folders";
import { setDocumentTags, listDocumentTags } from "./repo/tags";
import { upsertOutput } from "./repo/outputs";
import { listProfiles, getDefaultProfileId, updateProfile } from "./repo/agentProfiles";
import { orderedFallbackConfigs } from "../agent/profiles";
import { pruneJobSnapshots } from "./repo/jobs";

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

  it("ortam kilidi varken failover zinciri boştur (env komutu başka CLI'a kaçmaz)", () => {
    const handle = createTestDb();
    vi.stubEnv("READFLOW_AGENT_CMD", "node scripts/mock-agent.mjs");
    try {
      expect(orderedFallbackConfigs(listProfiles(handle.db), undefined)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
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

  it("okuma durumu: varsayılan unread, done işaretlenince zaman damgası yazılır", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, {
        title: "Okuma akışı",
        sourceType: "text",
        originalText: "durum testi",
      });
      expect(getDocument(handle.db, doc.id)?.read_state).toBe("unread");

      setReadState(handle.db, doc.id, "reading");
      expect(getDocument(handle.db, doc.id)?.read_state).toBe("reading");
      expect(getDocument(handle.db, doc.id)?.read_at).toBeNull();
      expect(listDocuments(handle.db, { readState: "reading" }).map((d) => d.id)).toEqual([doc.id]);
      expect(listDocuments(handle.db, { readState: "done" })).toHaveLength(0);

      setReadState(handle.db, doc.id, "done");
      expect(getDocument(handle.db, doc.id)?.read_at).not.toBeNull();

      // Geri alınınca zaman damgası temizlenir
      setReadState(handle.db, doc.id, "unread");
      expect(getDocument(handle.db, doc.id)?.read_at).toBeNull();
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

describe("iş anlık görüntülerini temizleme", () => {
  it("eski bitmiş işlerin metin kopyasını siler; kaydı ve taze/bekleyen işleri korur", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, {
        title: "Temizlik",
        sourceType: "text",
        originalText: "uzun metin ".repeat(100),
      });
      const insert = (status: string, completedAt: string | null, createdAt: string) =>
        handle.db
          .prepare(
            `INSERT INTO jobs (document_id, operation, status, attempts, created_at, completed_at, source_kind, source_text, source_revision, notes_included, notes_text)
             VALUES (?, 'summary', ?, 1, ?, ?, 'original', ?, 0, 1, 'not metni')`,
          )
          .run(doc.id, status, createdAt, completedAt, "kopyalanmış metin ".repeat(50)).lastInsertRowid as number;

      const eski = insert("completed", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
      const eskiHatali = insert("failed", "2020-01-02T00:00:00.000Z", "2020-01-02T00:00:00.000Z");
      const yeni = insert("completed", new Date().toISOString(), new Date().toISOString());
      const bekleyen = insert("pending", null, "2020-01-01T00:00:00.000Z");

      expect(pruneJobSnapshots(handle.db)).toBe(2);
      const text = (id: number) =>
        handle.db.prepare(`SELECT source_text, notes_text, status FROM jobs WHERE id = ?`).get(id) as {
          source_text: string;
          notes_text: string | null;
          status: string;
        };
      expect(text(eski)).toMatchObject({ source_text: "", notes_text: null, status: "completed" });
      expect(text(eskiHatali).source_text).toBe("");
      expect(text(yeni).source_text.length).toBeGreaterThan(0);
      expect(text(bekleyen).source_text.length).toBeGreaterThan(0);

      // Tekrar çalıştırmak bir şey değiştirmez
      expect(pruneJobSnapshots(handle.db)).toBe(0);
    } finally {
      handle.cleanup();
    }
  });
});
