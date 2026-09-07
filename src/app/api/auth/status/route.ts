import { isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Middleware zaten oturumu denetler; burada yalnızca yapılandırma bilgisi var. */
export async function GET(): Promise<Response> {
  return Response.json({ authEnabled: isAuthConfigured() });
}
