import { NextResponse, type NextRequest } from "next/server";
import { isAuthConfigured, verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

// /api/ingest kendi taşıyıcı token'ıyla yetkilidir (bookmarklet cross-origin
// çalışır, SameSite=Lax cookie oraya gitmez) — oturum sınırının dışındadır.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/status",
  "/api/worker",
  "/api/ingest",
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Tek kullanıcı oturumu: kimlik bilgileri env ile yapılandırılmışsa tüm sayfa ve
 * API istekleri oturum ister (worker uçları kendi token'ıyla ayrı yetki sınırındadır).
 *
 * CSRF/origin: Origin başlığı tarayıcıdan gelir; aynı origin ise geçer, farklıysa
 * reddedilir. Origin başlığı yoksa (curl/worker gibi tarayıcı dışı istemciler)
 * istek oturum cookie'siyle yetkilendirilmek zorundadır — cookie HttpOnly +
 * SameSite=Lax olduğundan tarayıcılar arası CSRF yüzeyi kapalıdır.
 */
export default async function proxy(request: NextRequest): Promise<NextResponse> {
  if (!isAuthConfigured()) return NextResponse.next();

  const { pathname } = request.nextUrl;

  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  if (mutating && !pathname.startsWith("/api/worker") && !pathname.startsWith("/api/ingest")) {
    const origin = request.headers.get("origin");
    if (origin) {
      const originHost = new URL(origin).host;
      if (originHost !== request.headers.get("host")) {
        return NextResponse.json({ error: "Origin uyuşmuyor" }, { status: 403 });
      }
    }
  }

  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
  if (token && (await verifySessionToken(token))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Oturum gerekli" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
