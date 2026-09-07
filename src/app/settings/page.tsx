import { AgentSettings } from "@/components/AgentSettings";
import { BookmarkletCard } from "@/components/BookmarkletCard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ayarlar · Readflow" };

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.025em]">Ayarlar</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Tarayıcıdan içerik gönderme ve yerel AI bağlantı profilleri. Kimlik bilgileri
          CLI&apos;ın kendi oturumunda kalır; Readflow yalnızca CLI&apos;ı çalıştırır.
        </p>
      </header>
      <BookmarkletCard />
      <AgentSettings />
    </div>
  );
}
