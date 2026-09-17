import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import {
  createSessionToken,
  isAuthConfigured,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  verifyCredentials,
} from "@/lib/auth";
import { clientKey, loginThrottle } from "@/lib/authThrottle";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthConfigured()) {
      return Response.json({ error: "Oturum yapılandırılmamış (env eksik)" }, { status: 400 });
    }
    // Parola denemesini pratikte imkânsız kılar: istemci başına pencere sınırı.
    const key = clientKey(request);
    const limit = loginThrottle.check(key);
    if (limit.blocked) {
      return Response.json(
        { error: `Çok fazla başarısız deneme. ${limit.retryAfterSeconds} sn sonra tekrar deneyin.` },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
      );
    }
    const body = loginSchema.parse(await readJsonBody(request));
    if (!(await verifyCredentials(body.username, body.password))) {
      loginThrottle.fail(key);
      return Response.json({ error: "Kullanıcı adı veya şifre hatalı" }, { status: 401 });
    }
    loginThrottle.success(key);
    const token = await createSessionToken(body.username);
    const response = Response.json({ ok: true });
    const options = sessionCookieOptions();
    response.headers.append(
      "set-cookie",
      `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${options.maxAge}; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}`,
    );
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
