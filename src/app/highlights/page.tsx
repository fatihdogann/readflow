import { getT } from "@/lib/i18n/server";
import { HighlightsArchive } from "@/components/HighlightsArchive";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Vurgular · Readflow") };
}

export default async function HighlightsPage() {
  const t = await getT();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.025em]">{t("Vurgular")}</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {t("Tüm belgelerdeki altını çizdiklerin ve notların. Bir alıntıya tıklayınca belgesi açılır.")}</p>
      </header>
      <HighlightsArchive />
    </div>
  );
}
