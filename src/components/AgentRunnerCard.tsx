import { getDb } from "@/lib/db/connection";
import { getDefaultProfileId, listProfiles } from "@/lib/db/repo/agentProfiles";
import { isHeartbeatFresh, readHeartbeat } from "@/lib/jobs/worker";
import { getEnvironmentLock } from "@/lib/agent/profiles";

const SOURCE_LABEL: Record<string, string> = {
  env: "ortam değişkeni (env kilidi)",
  profile: "seçili profil",
  detected: "otomatik tespit",
};

/**
 * "İşleri şu an ne çalıştırıyor?" — bilgi worker'ın kendi kalp atışından gelir,
 * web sürecinin tahmininden değil. İkisi farklı PATH görebildiği için tek
 * güvenilir kaynak worker'dır.
 */
export function AgentRunnerCard() {
  const db = getDb();
  const heartbeat = readHeartbeat(db);
  const alive = isHeartbeatFresh(heartbeat);
  const lock = getEnvironmentLock();
  const defaultProfile = listProfiles(db).find((profile) => profile.id === getDefaultProfileId(db));
  const source = heartbeat?.agentSource ? SOURCE_LABEL[heartbeat.agentSource] ?? heartbeat.agentSource : null;

  return (
    <section
      aria-labelledby="runner-heading"
      className="rounded-2xl border border-stone-200 bg-white/70 p-4 shadow-[0_12px_34px_rgba(28,25,23,0.045)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none sm:p-5"
    >
      <h2 id="runner-heading" className="text-sm font-semibold">
        İşleri şu an ne çalıştırıyor?
      </h2>
      {alive && heartbeat ? (
        <p className="mt-2 text-sm">
          <strong>{heartbeat.agentName ?? "bilinmiyor"}</strong>
          {heartbeat.agentCommand ? (
            <code className="mx-1 rounded bg-stone-200/70 px-1 text-xs dark:bg-stone-800">{heartbeat.agentCommand}</code>
          ) : null}
          {source ? ` · kaynak: ${source}` : null}
        </p>
      ) : (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Worker çalışmıyor — işler kuyrukta bekler. Başlatmak için <code>pnpm app:install</code>.
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
        {lock.locked
          ? `Ortam değişkeni kilidi etkin (${lock.description}); profil seçimi yok sayılır.`
          : defaultProfile
            ? `Varsayılan profil: ${defaultProfile.name}. Seçim sabit olduğu için hangi CLI'ın çalışacağı değişmez.`
            : "Varsayılan profil seçilmedi: hangi CLI'ın çalışacağı, worker'ın gördüğü PATH'e göre değişebilir. Aşağıdan bir profili varsayılan yaparsan sabitlenir."}
      </p>
    </section>
  );
}
