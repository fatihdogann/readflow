import { getT } from "@/lib/i18n/server";
import { getDb, resolveDataDir } from "@/lib/db/connection";
import { backupStatus } from "@/lib/db/backup";

/** Tam arşiv yedeği: son yedek zamanı, 7 günü geçince hatırlatma ve indirme bağlantısı. */
export async function BackupCard() {
  const t = await getT();
  const { lastBackupAt, stale } = backupStatus(getDb());
  const lastDate = lastBackupAt ? new Date(lastBackupAt) : null;

  return (
    <section
      aria-labelledby="backup-heading"
      className="rounded-2xl border border-stone-200 bg-white/70 p-4 shadow-[0_12px_34px_rgba(28,25,23,0.045)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none sm:p-5"
    >
      <h2 id="backup-heading" className="text-sm font-semibold">
        {t("Yedek ve taşıma")}</h2>
      <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
        {t("Tüm arşiv tek bir SQLite dosyasıdır: belgeler, düzenlemeler, vurgular, AI çıktıları ve geçmiş. İndirilen dosyayı başka bir bilgisayarda")}{" "}<code>pnpm db:restore &lt;dosya&gt;</code> {" "}{t("ile geri yükleyebilirsin.")}</p>
      <p
        role={stale ? "status" : undefined}
        className={`mt-3 text-sm ${stale ? "font-medium text-amber-700 dark:text-amber-400" : "text-stone-600 dark:text-stone-400"}`}
      >
        {lastDate
          ? t("Son yedek: {0}", lastDate.toLocaleString(t("tr-TR"), { dateStyle: "medium", timeStyle: "short" }))
          : t("Henüz yedek alınmadı.")}
        {stale ? t(" Yeni bir yedek alıp Mac dışında saklaman önerilir.") : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a
          href="/api/backup"
          download
          className="inline-flex min-h-10 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-stone-50 hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          {t("Yedeği indir")}</a>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {t("Kopyası:")}{" "}<code>{resolveDataDir()}/backups</code>
        </span>
      </div>
    </section>
  );
}
