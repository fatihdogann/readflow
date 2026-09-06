import { AgentSettings } from "@/components/AgentSettings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ayarlar · Readflow" };

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ayarlar</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Yerel AI bağlantı profilleri. Kimlik bilgileri CLI&apos;ın kendi oturumunda kalır;
          Readflow yalnızca CLI&apos;ı çalıştırır.
        </p>
      </header>
      <AgentSettings />
    </div>
  );
}
