import { HistoryView, parseHistoryFilters } from "@/components/HistoryView";

export const dynamic = "force-dynamic";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <HistoryView filters={parseHistoryFilters(params)} title="Geçmiş" />;
}
