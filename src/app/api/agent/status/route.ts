import { getDb } from "@/lib/db/connection";
import { countsByStatus } from "@/lib/db/repo/jobs";
import { isHeartbeatFresh, readHeartbeat } from "@/lib/jobs/worker";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const heartbeat = readHeartbeat(db);
  const counts = countsByStatus(db);
  const workerAlive = isHeartbeatFresh(heartbeat);
  return Response.json({
    workerAlive,
    lastHeartbeat: heartbeat?.ts ?? null,
    agentMode: heartbeat?.agentMode ?? null,
    agentName: heartbeat?.agentName ?? null,
    message: heartbeat?.message ?? null,
    lastError: heartbeat?.lastError ?? null,
    counts,
  });
}
