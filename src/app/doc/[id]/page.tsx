import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/connection";
import { listFolders } from "@/lib/db/repo/folders";
import { getDocumentDetail } from "@/lib/documents/service";
import { DocWorkspace } from "@/components/DocWorkspace";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const db = getDb();
  const detail = getDocumentDetail(db, numericId);
  if (!detail) notFound();

  return <DocWorkspace initial={detail} folders={listFolders(db)} />;
}
