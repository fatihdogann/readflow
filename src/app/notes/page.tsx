import { NotesBoard } from "@/components/NotesBoard";
import { getDb } from "@/lib/db/connection";
import { listFolders } from "@/lib/db/repo/folders";
import { listNotes } from "@/lib/db/repo/notes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notlar · Readflow" };

export default function NotesPage() {
  const db = getDb();
  return <div className="mx-auto w-full max-w-3xl"><header className="mb-5"><h1 className="text-2xl font-semibold tracking-[-0.025em]">Notlar</h1><p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Notu klasöre bırak; telefonda basılı tutarak işlemlerini aç.</p></header><NotesBoard initialNotes={listNotes(db)} folders={listFolders(db)} /></div>;
}
