/** Readability byline'ında DOM düğümleri arasında kaybolan ayraçları geri koyar. */
export function formatAuthorByline(value: string): string {
  return value
    .replace(/([\p{Ll}])(?=[\p{Lu}][\p{Ll}])/gu, "$1, ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}
