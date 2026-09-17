import fs from "node:fs";
import path from "node:path";
import { apiErrorResponse } from "@/lib/api/http";
import { getDb, resolveDataDir } from "@/lib/db/connection";
import { createBackup } from "@/lib/db/backup";

export const dynamic = "force-dynamic";

/** Tam arşivi (SQLite) indirir; kopyası veri dizinindeki backups/ altında da kalır. */
export async function GET(): Promise<Response> {
  try {
    const file = createBackup(getDb(), resolveDataDir());
    // ponytail: dosya belleğe okunur; arşiv yüzlerce MB olursa stream'e geç.
    return new Response(fs.readFileSync(file), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
