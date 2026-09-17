import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/db/testDb";
import { getMeta } from "@/lib/db/repo/meta";
import { getOrCreateIngestToken } from "../ingest/route";
import { POST } from "./route";

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

const rotate = (host: string) =>
  POST(new Request("http://localhost/api/bookmarklet", { method: "POST", headers: { host } }));

describe("bookmarklet token yenileme", () => {
  it("localhost'tan yenilenir ve eski token geçersiz olur", async () => {
    const before = getOrCreateIngestToken();
    expect((await rotate("localhost")).status).toBe(200);
    const after = getMeta(handle.db, "ingest_token");
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it("uzak origin'den (oturum yapılandırılmamışken) reddedilir", async () => {
    const before = getOrCreateIngestToken();
    expect((await rotate("baska-makine.example")).status).toBe(400);
    expect(getMeta(handle.db, "ingest_token")).toBe(before);
  });
});
