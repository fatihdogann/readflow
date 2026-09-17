import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb, type TestDbHandle } from "../db/testDb";
import { insertDocument } from "../db/repo/documents";
import { listDocumentTags } from "../db/repo/tags";
import { importPaths, parseCsv, parseUrlList } from "./index";

describe("parseCsv", () => {
  it("tırnaklı alanları, virgülü ve satır sonunu korur", () => {
    expect(parseCsv('a,b\n"x, y","satır\n2"\r\n3,"""q"""')).toEqual([
      ["a", "b"],
      ["x, y", "satır\n2"],
      ["3", '"q"'],
    ]);
  });
});

describe("parseUrlList", () => {
  it("Instapaper/Readwise tarzı CSV'den adres, başlık ve etiket okur", () => {
    const csv = 'URL,Title,Selection,Folder,Timestamp,Tags\nhttps://a.example/1,Bir,,Unread,1,"[""okuma"",""iş""]"\nhttps://a.example/2,İki,,Unread,2,';
    expect(parseUrlList(csv, "instapaper-export.csv")).toEqual([
      { url: "https://a.example/1", title: "Bir", tags: ["okuma", "iş"] },
      { url: "https://a.example/2", title: "İki", tags: [] },
    ]);
  });

  it("Pocket CSV'sindeki | ayraçlı etiketleri böler", () => {
    const csv = "title,url,time_added,tags,status\nBaşlık,https://p.example/x,1,a|b,unread";
    expect(parseUrlList(csv, "part_000000.csv")?.[0]).toEqual({ url: "https://p.example/x", title: "Başlık", tags: ["a", "b"] });
  });

  it("Netscape yer imi / Pocket HTML dosyasını okur", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://b.example/y" TAGS="x,y">Yer &amp; imi</A></DL>`;
    expect(parseUrlList(html, "bookmarks.html")).toEqual([{ url: "https://b.example/y", title: "Yer & imi", tags: ["x", "y"] }]);
  });

  it("adres sütunu olmayan CSV ve normal HTML makale liste sayılmaz", () => {
    expect(parseUrlList("ad,soyad\nA,B", "kisiler.csv")).toBeNull();
    expect(parseUrlList("<html><title>Makale</title><a href='https://x.example'>x</a></html>", "makale.html")).toBeNull();
  });
});

describe("importPaths", () => {
  let handle: TestDbHandle;
  let dir: string;
  beforeEach(() => {
    handle = createTestDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-import-"));
  });
  afterEach(() => {
    handle.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("klasördeki belgeleri ve bağlantı listesini içe aktarır, tekrarları atlar", async () => {
    fs.mkdirSync(path.join(dir, "alt"));
    fs.writeFileSync(path.join(dir, "not.md"), "# Not\n\nMarkdown içerik satırı.");
    fs.copyFileSync(
      path.join(__dirname, "..", "extraction", "__fixtures__", "sample-article.html"),
      path.join(dir, "alt", "makale.html"),
    );
    fs.writeFileSync(path.join(dir, "gizli.bin"), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(dir, ".DS_Store"), "x");
    fs.writeFileSync(
      path.join(dir, "liste.csv"),
      "url,title,tags\nhttps://c.example/yeni,Yeni,oku\nhttps://c.example/var,Var,\nhttps://c.example/hata,Hata,",
    );
    insertDocument(handle.db, {
      title: "Var",
      sourceType: "url",
      sourceUrl: "https://c.example/var",
      originalText: "zaten arşivde",
    });

    const fetched: string[] = [];
    const options = {
      delayMs: 0,
      fetchUrl: async (url: string) => {
        fetched.push(url);
        if (url.endsWith("hata")) throw new Error("403");
        return { html: `<html><head><title>${url}</title></head><body><article><p>${"uzun metin ".repeat(40)}</p></article></body></html>` };
      },
    };
    const first = await importPaths(handle.db, [dir], options);
    expect(first.created).toBe(3); // not.md, makale.html, yeni
    expect(first.skipped).toBe(2); // var (arşivde), gizli.bin (desteklenmiyor)
    expect(first.failed.map((f) => f.item)).toEqual(["https://c.example/hata"]);
    expect(fetched).toEqual(["https://c.example/yeni", "https://c.example/hata"]);

    const created = handle.db
      .prepare(`SELECT id, title FROM documents WHERE source_url = ?`)
      .get("https://c.example/yeni") as { id: number; title: string };
    expect(created.title).toBe("Yeni");
    expect(listDocumentTags(handle.db, created.id)).toEqual(["oku"]);

    // İkinci çalıştırma hiçbir şey eklemez
    const second = await importPaths(handle.db, [dir], options);
    expect(second.created).toBe(0);
    const count = handle.db.prepare(`SELECT COUNT(*) AS c FROM documents`).get() as { c: number };
    expect(count.c).toBe(4);
  });
});
