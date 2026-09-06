import { getDb } from "@/lib/db/connection";
import { countsByStatus } from "@/lib/db/repo/jobs";
import { getDefaultProfileId, listProfiles } from "@/lib/db/repo/agentProfiles";
import { isHeartbeatFresh, readHeartbeat } from "@/lib/jobs/worker";
import { getEnvironmentLock } from "@/lib/agent/profiles";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const heartbeat = readHeartbeat(db);
  const workerAlive = isHeartbeatFresh(heartbeat);
  const profiles = listProfiles(db).map((profile) => ({
    id: profile.id,
    name: profile.name,
    cli: profile.cli,
    model: profile.model,
    enabled: profile.enabled,
  }));
  return Response.json({
    workerAlive,
    lastHeartbeat: heartbeat?.ts ?? null,
    agentMode: heartbeat?.agentMode ?? null,
    agentName: heartbeat?.agentName ?? null,
    fallbackAgentName: heartbeat?.fallbackAgentName ?? null,
    currentJobId: heartbeat?.currentJobId ?? null,
    message: heartbeat?.message ?? null,
    lastError: heartbeat?.lastError ?? null,
    counts: countsByStatus(db),
    envLock: getEnvironmentLock(),
    defaultProfileId: getDefaultProfileId(db),
    profiles,
  });
}
