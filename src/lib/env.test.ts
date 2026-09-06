import { describe, expect, it } from "vitest";
import { loadLocalEnv } from "./env";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("loadLocalEnv", () => {
  it(".env.local'ı yükler ve mevcut env'i ezmez", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-env-"));
    try {
      fs.writeFileSync(path.join(dir, ".env.local"), "READFLOW_TEST_VALUE=abc\nREADFLOW_EXISTING=fromfile\n# yorum\nBOZUK_SATIR\n");
      process.env.READFLOW_EXISTING = "already";
      loadLocalEnv(dir);
      expect(process.env.READFLOW_TEST_VALUE).toBe("abc");
      expect(process.env.READFLOW_EXISTING).toBe("already");
    } finally {
      delete process.env.READFLOW_TEST_VALUE;
      delete process.env.READFLOW_EXISTING;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dosya yoksa sessizce geçer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-env-empty-"));
    try {
      expect(() => loadLocalEnv(dir)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
