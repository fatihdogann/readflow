import { describe, expect, it } from "vitest";
import { createTestDb } from "../../db/testDb";
import { insertDocument, getDocument } from "./documents";
import { saveEdit } from "./documentEdits";
import {
  cancelJob,
  claimJobById,
  claimNextJob,
  completeJob,
  createJob,
  countsByStatus,
  DEFAULT_LEASE_MS,
  failJob,
  finalizeCancel,
  isCancelRequested,
  newWorkerId,
  recoverExpiredLeases,
  releaseJob,
  renewLease,
  retryJob,
  type JobRow,
} from "./jobs";
import { getOutput, listOutputRevisions } from "./outputs";
import { processJob } from "../../jobs/worker";
import { MockAgentAdapter } from "../../agent/mock";
import { createJobWithSnapshot } from "../../jobs/create";

const W1 = "worker-one";
const W2 = "worker-two";

function setup() {
  const handle = createTestDb();
  const doc = insertDocument(handle.db, {
    title: "T",
    sourceType: "text",
    originalText: "gövde metni",
  });
  return { handle, doc };
}

describe("job queue: claim & sahiplik", () => {
  it("claim atomiktir: aynı job iki worker'a dağıtılamaz", () => {
    const { handle, doc } = setup();
    try {
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      createJob(handle.db, { documentId: doc.id, operation: "summary", summaryLevel: "normal" });

      const first = claimNextJob(handle.db, W1);
      const second = claimNextJob(handle.db, W2);
      expect(first?.owner).toBe(W1);
      expect(second?.owner).toBe(W2);
      expect(first?.id).not.toBe(second?.id);
      expect(claimNextJob(handle.db, W1)).toBeNull();
      expect(first?.lease_expires_at).toBeTruthy();
    } finally {
      handle.cleanup();
    }
  });

  it("claimJobById yalnızca pending job'ı alır", () => {
    const { handle, doc } = setup();
    try {
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      expect(claimJobById(handle.db, job.id, W1)?.status).toBe("processing");
      expect(claimJobById(handle.db, job.id, W2)).toBeNull();
    } finally {
      handle.cleanup();
    }
  });

  it("geç gelen sonuç yeni sahibi ezmez", () => {
    const { handle, doc } = setup();
    try {
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db, W1);
      // W1'in lease'i dolmuş varsay; W2 kurtarıp alıyor
      handle.db
        .prepare(`UPDATE jobs SET lease_expires_at = ?`)
        .run(new Date(Date.now() - 1000).toISOString());
      recoverExpiredLeases(handle.db);
      const reclaimed = claimNextJob(handle.db, W2)!;
      expect(reclaimed.owner).toBe(W2);
      // W1'in geç gelen tamamlaması reddedilir
      expect(() =>
        completeJob(handle.db, { jobId: job.id, owner: W1, content: "geç gelen" }),
      ).toThrow(/sahipliği/);
      completeJob(handle.db, { jobId: job.id, owner: W2, content: "güncel sonuç" });
      expect(getOutput(handle.db, 1)?.content).toBe("güncel sonuç");
    } finally {
      handle.cleanup();
    }
  });

  it("süresi dolup kuyruğa dönen işi eski sahibi başarısız yapamaz", () => {
    const { handle, doc } = setup();
    try {
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db, W1);
      handle.db
        .prepare(`UPDATE jobs SET lease_expires_at = ? WHERE id = ?`)
        .run(new Date(Date.now() - 1000).toISOString(), job.id);
      recoverExpiredLeases(handle.db);

      expect(() => failJob(handle.db, job.id, W1, "geç kalan hata")).toThrow(/sahipliği|işlenmiyor/);
      expect(handle.db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(job.id)).toMatchObject({
        status: "pending",
      });
    } finally {
      handle.cleanup();
    }
  });

  it("yalnızca süresi dolmuş lease'ler kurtarılır; aktif iş korunur", () => {
    const { handle, doc } = setup();
    try {
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db, W1);
      // Lease taze — kurtarılmaz
      expect(recoverExpiredLeases(handle.db)).toBe(0);
      // Süre geçmiş — kurtarılır ve attempts korunur
      handle.db
        .prepare(`UPDATE jobs SET lease_expires_at = ?`)
        .run(new Date(Date.now() - 1000).toISOString());
      expect(recoverExpiredLeases(handle.db)).toBe(1);
      expect(countsByStatus(handle.db)).toMatchObject({ pending: 1 });
    } finally {
      handle.cleanup();
    }
  });

  it("releaseJob attempts'ı bozmadan pending'e döndürür", () => {
    const { handle, doc } = setup();
    try {
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      const job = claimNextJob(handle.db, W1)!;
      releaseJob(handle.db, job.id, W1);
      const released = handle.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id) as JobRow;
      expect(released.status).toBe("pending");
      expect(released.attempts).toBe(0);
    } finally {
      handle.cleanup();
    }
  });

  it("renewLease yalnızca sahibi uzatır", () => {
    const { handle, doc } = setup();
    try {
      createJob(handle.db, { documentId: doc.id, operation: "readability" });
      const job = claimNextJob(handle.db, W1)!;
      expect(renewLease(handle.db, job.id, W2)).toBe(false);
      expect(renewLease(handle.db, job.id, W1)).toBe(true);
    } finally {
      handle.cleanup();
    }
  });
});

describe("job queue: idempotency & snapshot", () => {
  it("aktif aynı iş için yeni job açılmaz; forceNew ile iptal + yenisi", () => {
    const { handle, doc } = setup();
    try {
      const a = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      const b = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      expect(a.id).toBe(b.id);

      const forced = createJob(handle.db, {
        documentId: doc.id,
        operation: "readability",
        forceNew: true,
      });
      expect(forced.id).not.toBe(a.id);
      const old = handle.db.prepare(`SELECT status, error FROM jobs WHERE id = ?`).get(a.id) as {
        status: string;
        error: string;
      };
      expect(old.status).toBe("failed");
      expect(old.error).toContain("iptal");
    } finally {
      handle.cleanup();
    }
  });

  it("createJobWithSnapshot kaynak metni ve AI yapılandırmasını sabitler; sonraki değişiklik işi etkilemez", () => {
    const { handle, doc } = setup();
    try {
      saveEdit(handle.db, doc.id, "düzenlenmiş sürüm", 0);
      const job = createJobWithSnapshot(handle.db, {
        documentId: doc.id,
        operation: "readability",
        includeNotes: false,
      });
      expect(job.source_kind).toBe("edited");
      expect(job.source_text).toBe("düzenlenmiş sürüm");

      // Sonraki düzenleme bekleyen işi etkilemez
      saveEdit(handle.db, doc.id, "sonraki değişiklik", 1);
      const stillPending = handle.db.prepare(`SELECT source_text FROM jobs WHERE id = ?`).get(job.id) as {
        source_text: string;
      };
      expect(stillPending.source_text).toBe("düzenlenmiş sürüm");

      // Retry aynı snapshot'ı taşır
      claimNextJob(handle.db, W1);
      failJob(handle.db, job.id, W1, "geçici hata");
      const retried = retryJob(handle.db, job.id);
      expect(retried.source_text).toBe("düzenlenmiş sürüm");
    } finally {
      handle.cleanup();
    }
  });

  it("farklı kaynak veya AI snapshot'ları ayrı aktif işler oluşturur", () => {
    const { handle, doc } = setup();
    try {
      const original = createJob(handle.db, {
        documentId: doc.id,
        operation: "summary",
        summaryLevel: "normal",
        sourceKind: "original",
        sourceText: "orijinal",
        sourceRevision: 0,
        aiConfig: { kind: "profile", profile_id: 1, cli: "claude", config_revision: 1 },
      });
      const edited = createJob(handle.db, {
        documentId: doc.id,
        operation: "summary",
        summaryLevel: "normal",
        sourceKind: "edited",
        sourceText: "düzenlenmiş",
        sourceRevision: 2,
        aiConfig: { kind: "profile", profile_id: 2, cli: "codex", config_revision: 3 },
      });
      const duplicate = createJob(handle.db, {
        documentId: doc.id,
        operation: "summary",
        summaryLevel: "normal",
        sourceKind: "edited",
        sourceText: "düzenlenmiş",
        sourceRevision: 2,
        aiConfig: { kind: "profile", profile_id: 2, cli: "codex", config_revision: 3 },
      });

      expect(edited.id).not.toBe(original.id);
      expect(duplicate.id).toBe(edited.id);
    } finally {
      handle.cleanup();
    }
  });

  it("not dahil etme seçimi snapshot'a girer", () => {
    const { handle, doc } = setup();
    try {
      handle.db
        .prepare(`UPDATE documents SET note = ? WHERE id = ?`)
        .run("kullanıcı notu", doc.id);
      const included = createJobWithSnapshot(handle.db, {
        documentId: doc.id,
        operation: "summary",
        summaryLevel: "short",
        includeNotes: true,
      });
      expect(included.notes_included).toBe(1);
      expect(included.notes_text).toBe("kullanıcı notu");

      const excluded = createJobWithSnapshot(handle.db, {
        documentId: doc.id,
        operation: "summary",
        summaryLevel: "normal",
        includeNotes: false,
      });
      expect(excluded.notes_included).toBe(0);
    } finally {
      handle.cleanup();
    }
  });
});

describe("job queue: tamamlama ve revizyonlar", () => {
  it("completeJob çıktı + değişmez revizyon yazar; orijinal korunur", () => {
    const { handle, doc } = setup();
    try {
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db, W1);
      const { outputId, revisionId } = completeJob(handle.db, {
        jobId: job.id,
        owner: W1,
        content: "v1",
        agentName: "mock",
      });
      // Yeniden üretim: mevcut çıktı güncellenir, yeni revizyon eklenir
      createJob(handle.db, { documentId: doc.id, operation: "readability", forceNew: true });
      claimNextJob(handle.db, W1);
      completeJob(handle.db, { jobId: job.id + 1, owner: W1, content: "v2", agentName: "mock" });

      expect(getOutput(handle.db, outputId)?.content).toBe("v2");
      const revisions = listOutputRevisions(handle.db, outputId);
      expect(revisions).toHaveLength(2);
      expect(revisions.map((revision) => revision.content)).toEqual(["v2", "v1"]);
      expect(revisions[0]?.job_id).toBe(job.id + 1);
      expect(revisionId).toBeGreaterThan(0);
      expect(getDocument(handle.db, doc.id)?.original_text).toBe("gövde metni");
    } finally {
      handle.cleanup();
    }
  });

  it("processJob ile mock adapter uçtan uca çalışır ve sahiplikle tamamlanır", async () => {
    const { handle, doc } = setup();
    try {
      const job = createJobWithSnapshot(handle.db, {
        documentId: doc.id,
        operation: "readability",
      });
      const claimed = claimNextJob(handle.db, W1)!;
      await processJob(handle.db, new MockAgentAdapter(), claimed, W1);
      const detail = handle.db
        .prepare(`SELECT status, agent_name FROM jobs j LEFT JOIN document_outputs o ON o.document_id = j.document_id WHERE j.id = ?`)
        .get(job.id) as { status: string; agent_name: string };
      expect(detail.status).toBe("completed");
      expect(detail.agent_name).toBe("mock");
    } finally {
      handle.cleanup();
    }
  });

  it("processJob profil snapshot'ındaki timeout değerini adapter'a iletir", async () => {
    const { handle, doc } = setup();
    try {
      createJob(handle.db, {
        documentId: doc.id,
        operation: "readability",
        sourceText: "gövde",
        aiConfig: { kind: "profile", cli: "codex", timeout_ms: 42_000 },
      });
      const claimed = claimNextJob(handle.db, W1)!;
      let receivedTimeout = 0;
      await processJob(
        handle.db,
        {
          name: "capture",
          async run(task) {
            receivedTimeout = task.timeoutMs;
            return { text: "çıktı", meta: {} };
          },
        },
        claimed,
        W1,
      );

      expect(receivedTimeout).toBe(42_000);
    } finally {
      handle.cleanup();
    }
  });

  it("failJob + retryJob akışı çalışır ve sahiplik doğrular", () => {
    const { handle, doc } = setup();
    try {
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db, W1);
      expect(() => failJob(handle.db, job.id, W2, "yabancı hata")).toThrow(/sahipliği/);
      failJob(handle.db, job.id, W1, "agent patladı");
      const failed = handle.db.prepare(`SELECT status, error FROM jobs WHERE id = ?`).get(job.id) as {
        status: string;
        error: string;
      };
      expect(failed.status).toBe("failed");
      expect(failed.error).toContain("agent patladı");
      expect(retryJob(handle.db, job.id).status).toBe("pending");
      expect(() => retryJob(handle.db, job.id)).toThrow(/Yalnızca başarısız/);
    } finally {
      handle.cleanup();
    }
  });
});

describe("job iptali", () => {
  it("pending iş anında iptal olur; sonuclanan işe dokunmaz", () => {
    const { handle, doc } = setup();
    try {
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      const outcome = cancelJob(handle.db, job.id);
      expect(outcome.action).toBe("cancelled");
      const row = handle.db
        .prepare(`SELECT status, cancelled, error FROM jobs WHERE id = ?`)
        .get(job.id) as { status: string; cancelled: number; error: string };
      expect(row.status).toBe("failed");
      expect(row.cancelled).toBe(1);
      expect(row.error).toBe("İptal edildi");
      expect(cancelJob(handle.db, job.id).action).toBe("already-finished");
    } finally {
      handle.cleanup();
    }
  });

  it("processing iptali: sahiplikli kesinleştirme, lease kurtarması yeniden başlatmaz, geç gelen sonuç reddedilir", () => {
    const { handle, doc } = setup();
    try {
      const job = createJob(handle.db, { documentId: doc.id, operation: "readability" });
      claimNextJob(handle.db, W1);
      expect(cancelJob(handle.db, job.id).action).toBe("abort-requested");
      expect(isCancelRequested(handle.db, job.id)).toBe(true);

      expect(finalizeCancel(handle.db, job.id, W2)).toBe(false);
      expect(finalizeCancel(handle.db, job.id, W1)).toBe(true);
      expect(countsByStatus(handle.db)).toMatchObject({ processing: 0 });
      expect(recoverExpiredLeases(handle.db)).toBe(0);
      expect(() =>
        completeJob(handle.db, { jobId: job.id, owner: W1, content: "geç gelen" }),
      ).toThrow(/işlenmiyor durumda değil/);

      const retried = retryJob(handle.db, job.id);
      expect(retried.cancelled).toBe(0);
      expect(retried.status).toBe("pending");
    } finally {
      handle.cleanup();
    }
  });
});

describe("worker id", () => {
  it("benzersiz worker kimliği üretir", () => {
    expect(newWorkerId()).not.toBe(newWorkerId());
    expect(DEFAULT_LEASE_MS).toBeGreaterThan(0);
  });
});
