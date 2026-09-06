import { loadLocalEnv } from "../lib/env";
import { openDatabase, resolveDataDir } from "../lib/db/connection";
import { ReadflowWorker } from "../lib/jobs/worker";

loadLocalEnv();

const db = openDatabase();
console.log(`[worker] Readflow worker başlatıldı (veri: ${resolveDataDir()})`);

const worker = new ReadflowWorker(db);
const { adapter, info } = worker.initialResolution;
if (adapter) {
  console.log(
    `[worker] Agent bağlı: ${adapter.name}${info.command ? ` (${info.command})` : ""} [kaynak: ${info.source ?? info.mode}]`,
  );
} else {
  console.warn(`[worker] Agent bağlı değil: ${info.message ?? "bilinmiyor"}`);
  console.warn("[worker] Job'lar pending kalacak; README'deki READFLOW_AGENT_CMD ile bağlayabilirsin.");
}

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} alındı, kapatılıyor…`);
  void worker.stopAndWait().then(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

worker.run().then(() => {
  console.log("[worker] Döngü sonlandı");
});
