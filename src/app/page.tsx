import { getDb } from "@/lib/db/connection";
import { listDocuments } from "@/lib/db/repo/documents";
import { listOutputSummariesForDocuments } from "@/lib/db/repo/outputs";
import { DocumentList, type OutputBadge } from "@/components/DocumentList";
import { NewDocumentForm } from "@/components/NewDocumentForm";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const db = getDb();
  const docs = listDocuments(db, { limit: 6 });
  const outputsByDoc = listOutputSummariesForDocuments(
    db,
    docs.map((doc) => doc.id),
  ) as Map<number, OutputBadge[]>;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
      <section>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Yeni</h1>
        <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
          Bir bağlantı yapıştır; sayfa burada indirilip ana makaleye ayrıştırılır. Ya da doğrudan
          metin bırak. Sonra <strong>Okunabilirliği Artır</strong> veya <strong>Özetle</strong>{" "}
          ile yerel agent&apos;ını iş yaptır.
        </p>
        <NewDocumentForm />
      </section>

      <section>
        <h2 className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          Son eklenenler
        </h2>
        <DocumentList docs={docs} outputsByDoc={outputsByDoc} />
      </section>
    </div>
  );
}
