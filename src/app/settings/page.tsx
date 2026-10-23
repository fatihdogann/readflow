import { getT } from "@/lib/i18n/server";
import { AgentRunnerCard } from "@/components/AgentRunnerCard";
import { AgentSettings } from "@/components/AgentSettings";
import { BackupCard } from "@/components/BackupCard";
import { BookmarkletCard } from "@/components/BookmarkletCard";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Ayarlar · Readflow") };
}

export default async function SettingsPage() {
  const t = await getT();
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.025em]">{t("Ayarlar")}</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {t("Tarayıcıdan içerik gönderme, yedekleme ve yerel AI bağlantı profilleri. Kimlik bilgileri CLI'ın kendi oturumunda kalır; Readflow yalnızca CLI'ı çalıştırır.")}</p>
      </header>
      <BookmarkletCard />
      <BackupCard />
      <AgentRunnerCard />
      <AgentSettings />
    </div>
  );
}
