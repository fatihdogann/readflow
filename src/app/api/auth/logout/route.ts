import { SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const response = Response.json({ ok: true });
  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
  return response;
}
