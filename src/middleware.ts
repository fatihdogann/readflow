import { NextResponse, type NextRequest } from "next/server";
import { isAuthConfigured, verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/status", "/api/worker", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Tek kullanıcı oturumu: kimlik bilgileri env ile yapılandırılmışsa tüm sayfa ve
 * API istekleri oturum ister (worker uçları kendi token'ıyla ayrı yetki sınırındadır).
 * Mutasyonlarda origin denetimi de yapılır (CSRF).
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (!isAuthConfigured()) return NextResponse.next();

  const { pathname } = request.nextUrl;

  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  if (mutating && !pathname.startsWith("/api/worker")) {
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
