import { describe, expect, it } from "vitest";
import { createTestDb } from "../../db/testDb";
import { insertDocument } from "../../db/repo/documents";
import {
  claimJobById,
  claimNextJob,
  completeJob,
  createJob,
  countsByStatus,
  failJob,
  recoverStaleProcessing,
  retryJob,
} from "./jobs";
import { getOutput } from "../repo/outputs";
import { processJob } from "../../jobs/worker";
import { MockAgentAdapter } from "../../agent/mock";
import { getDocumentDetail } from "../../documents/service";

describe("job queue", () => {
  it("claim atomiktir: aynı job iki kez dağıtılamaz", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      createJob(handle.db, { documentId: doc.id, operation: "summary", summaryLevel: "normal" });

      const first = claimNextJob(handle.db);
      const second = claimNextJob(handle.db);
      expect(first?.status).toBe("processing");
      expect(second?.status).toBe("processing");
      expect(first?.id).not.toBe(second?.id);
      expect(claimNextJob(handle.db)).toBeNull();
      expect(first?.attempts).toBe(1);
    } finally {
      handle.cleanup();
    }
  });

  it("claimJobById yalnızca pending job'ı alır", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      expect(claimJobById(handle.db, job.id)?.status).toBe("processing");
      expect(claimJobById(handle.db, job.id)).toBeNull();
    } finally {
      handle.cleanup();
    }
  });

  it("aktif aynı iş için yeni job açılmaz (idempotent)", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      const a = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      const b = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      expect(a.id).toBe(b.id);
    } finally {
      handle.cleanup();
    }
  });

  it("completeJob çıktıyı yazar ve job'ı tamamlar", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db);
      const { outputId } = completeJob(handle.db, {
        jobId: job.id,
        content: "düzenlenmiş içerik",
        agentName: "mock",
      });
      expect(getOutput(handle.db, outputId)?.content).toBe("düzenlenmiş içerik");
      expect(handle.db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(job.id)).toMatchObject({
        status: "completed",
      });
      // orijinal içerik asla değişmez
      expect(handle.db.prepare(`SELECT original_text FROM documents WHERE id = ?`).get(doc.id))
        .toMatchObject({ original_text: "m" });
    } finally {
      handle.cleanup();
    }
  });

  it("failJob + retryJob akışı çalışır", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db);
      failJob(handle.db, job.id, "agent patladı");
      const failed = handle.db.prepare(`SELECT status, error FROM jobs WHERE id = ?`).get(job.id) as {
        status: string;
        error: string;
      };
      expect(failed.status).toBe("failed");
      expect(failed.error).toContain("agent patladı");

      const retried = retryJob(handle.db, job.id);
      expect(retried.status).toBe("pending");

      expect(() => retryJob(handle.db, job.id)).toThrow(/Yalnızca başarısız/);
    } finally {
      handle.cleanup();
    }
  });

  it("recoverStaleProcessing işleme takılan job'ları geri koyar", () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, { title: "T", sourceType: "text", originalText: "m" });
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db);
      expect(recoverStaleProcessing(handle.db)).toBe(1);
      expect(countsByStatus(handle.db)).toMatchObject({ pending: 1, processing: 0 });
    } finally {
      handle.cleanup();
    }
  });

  it("processJob ile mock adapter uçtan uca çalışır", async () => {
    const handle = createTestDb();
    try {
      const doc = insertDocument(handle.db, {
        title: "Uçtan uca",
        sourceType: "text",
        originalText: "Deneme paragrafı. İkinci cümle.",
      });
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      const claimed = claimNextJob(handle.db)!;
      await processJob(handle.db, new MockAgentAdapter(), claimed);

      const detail = getDocumentDetail(handle.db, doc.id);
      expect(detail?.jobs[0]?.status).toBe("completed");
      expect(detail?.outputs).toHaveLength(1);
      expect(detail?.outputs[0]?.operation).toBe("readability");
      expect(detail?.outputs[0]?.agent_name).toBe("mock");
    } finally {
      handle.cleanup();
    }
  });
});
