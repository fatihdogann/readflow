import { HistoryView, parseHistoryFilters } from "@/components/HistoryView";

export const dynamic = "force-dynamic";

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseHistoryFilters(params);
  return <HistoryView filters={{ ...filters, favorite: true }} title="Favoriler" />;
}
