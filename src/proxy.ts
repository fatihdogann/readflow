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
/**
 * İçerik güvenlik politikası. Script tarafı sıkı: her istekte üretilen nonce +
 * `strict-dynamic`, yani sayfaya sızan bir script çalışamaz. Stil tarafında
 * `unsafe-inline` var çünkü birkaç bileşen satır içi `style` kullanıyor
 * (okuma ilerlemesi, vurgu konumlandırma). `upgrade-insecure-requests` yok:
 * uygulama http://127.0.0.1 üzerinden de açılıyor.
 */
function cspFor(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = cspFor(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  /** CSP her yanıta eklenir; nonce yalnız sayfa render'ına geçer. */
  const withCsp = (response: NextResponse): NextResponse => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  const pass = (): NextResponse => withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  if (!isAuthConfigured()) return pass();

  const { pathname } = request.nextUrl;

  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  if (mutating && !pathname.startsWith("/api/worker") && !pathname.startsWith("/api/ingest")) {
    const origin = request.headers.get("origin");
    if (origin) {
      const originHost = new URL(origin).host;
      if (originHost !== request.headers.get("host")) {
        return withCsp(NextResponse.json({ error: "Origin uyuşmuyor" }, { status: 403 }));
      }
    }
  }

  if (isPublic(pathname)) return pass();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
  if (token && (await verifySessionToken(token))) return pass();

  if (pathname.startsWith("/api/")) {
    return withCsp(NextResponse.json({ error: "Oturum gerekli" }, { status: 401 }));
  }
  const loginUrl = new URL("/login", request.url);
  return withCsp(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)"],
};
