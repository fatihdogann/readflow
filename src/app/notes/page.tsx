import { getT } from "@/lib/i18n/server";
import { NotesBoard } from "@/components/NotesBoard";
import { getDb } from "@/lib/db/connection";
import { listFolders } from "@/lib/db/repo/folders";
import { listNotes } from "@/lib/db/repo/notes";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getT();
  return { title: t("Notlar · Readflow") };
}

export default async function NotesPage() {
  const t = await getT();
  const db = getDb();
  return <div className="mx-auto w-full max-w-3xl"><header className="mb-5"><h1 className="text-2xl font-semibold tracking-[-0.025em]">{t("Notlar")}</h1><p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t("Notu klasöre bırak; telefonda basılı tutarak işlemlerini aç.")}</p></header><NotesBoard initialNotes={listNotes(db)} folders={listFolders(db)} /></div>;
}
