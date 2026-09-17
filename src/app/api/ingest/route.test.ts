import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/db/testDb";
import { getDocument } from "@/lib/db/repo/documents";
import { POST, getOrCreateIngestToken } from "./route";

const store = globalThis as unknown as { __readflowTestDb?: TestDbHandle["db"] };
let handle: TestDbHandle;

beforeEach(() => {
  handle = createTestDb();
  store.__readflowTestDb = handle.db;
});
afterEach(() => {
  delete store.__readflowTestDb;
  handle.cleanup();
});

const post = (body: unknown, token?: string) =>
  POST(
    new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

describe("/api/ingest", () => {
  it("token olmadan reddeder", async () => {
    getOrCreateIngestToken();
    expect((await post({ text: "merhaba" })).status).toBe(401);
    expect((await post({ text: "merhaba" }, "yanlis-token")).status).toBe(401);
  });

  it("paylaşım menüsünden gelen düz metni kaydeder (iOS Kestirmeler)", async () => {
    const token = getOrCreateIngestToken();
    const response = await post({ text: "Paylaşılan not\n\nTelefondan gelen metin." }, token);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: number };
    expect(getDocument(handle.db, id)?.original_text).toContain("Telefondan gelen metin.");
  });

  it("metin olarak gelen bağlantıyı URL yoluna yönlendirir (SSRF denetimi devrede)", async () => {
    const token = getOrCreateIngestToken();
    const response = await post({ text: "http://127.0.0.1/admin" }, token);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).not.toMatch(/html, url veya text/);
  });

  it("boş gövdeyi 400 ile reddeder", async () => {
    const token = getOrCreateIngestToken();
    expect((await post({}, token)).status).toBe(400);
  });
});
