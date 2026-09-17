import { getDb } from "@/lib/db/connection";

export const dynamic = "force-dynamic";

// Salt-okunur sağlık ucu: ayrıntı sızdırmaz, yalnız süreç + DB okunabilirliği.
export async function GET(): Promise<Response> {
  try {
    getDb().prepare("SELECT 1").get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
