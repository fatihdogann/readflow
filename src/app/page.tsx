import { getDb } from "@/lib/db/connection";
import { listDocuments } from "@/lib/db/repo/documents";
import { listOutputSummariesForDocuments } from "@/lib/db/repo/outputs";
import { DocumentList, type OutputBadge } from "@/components/DocumentList";
import { NewDocumentForm } from "@/components/NewDocumentForm";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const db = getDb();
  const reading = listDocuments(db, { readState: "reading", limit: 4 });
  const docs = listDocuments(db, { limit: 6 });
  const outputsByDoc = listOutputSummariesForDocuments(
    db,
    [...reading, ...docs].map((doc) => doc.id),
  ) as Map<number, OutputBadge[]>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12">
      <section className="pt-4 md:pt-8">
        <h1 className="mb-2 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-4xl">Okumak istediğin şeyi buraya bırak.</h1>
        <p className="mb-6 max-w-2xl text-sm leading-relaxed text-stone-600 dark:text-stone-400">
          Bir bağlantı yapıştır; sayfa burada indirilip ana makaleye ayrıştırılır. Ya da doğrudan
          metin bırak. Sonra <strong>Okunabilirliği Artır</strong> veya <strong>Özetle</strong>{" "}
          ile yerel agent&apos;ını iş yaptır.
        </p>
        <NewDocumentForm />
      </section>

      {reading.length > 0 ? (
        <section>
          <h2 className="mb-3 px-1 text-sm font-semibold tracking-tight text-stone-700 dark:text-stone-300">
            Okumaya devam et
          </h2>
          <DocumentList docs={reading} outputsByDoc={outputsByDoc} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold tracking-tight text-stone-700 dark:text-stone-300">
          Son eklenenler
        </h2>
        <DocumentList docs={docs} outputsByDoc={outputsByDoc} />
      </section>
    </div>
  );
}
