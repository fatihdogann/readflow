import { HighlightsArchive } from "@/components/HighlightsArchive";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vurgular · Readflow" };

export default function HighlightsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.025em]">Vurgular</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Tüm belgelerdeki altını çizdiklerin ve notların. Bir alıntıya tıklayınca belgesi açılır.
        </p>
      </header>
      <HighlightsArchive />
    </div>
  );
}
