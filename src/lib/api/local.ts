import { isAuthConfigured, verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { InputError } from "../types";

/**
 * Ayar/entegrasyon mutasyonları için yetki:
 * - Oturum yapılandırılmışsa (Coolify üretimi): geçerli oturum cookie'si yeterli —
 *   kullanıcı hangi alan adından girerse girsin profilini yönetebilir.
 * - Oturum yapılandırılmamışsa (yerel geliştirme): yalnızca localhost.
 */
export async function assertMutationAllowed(request: Request): Promise<void> {
  if (isAuthConfigured()) {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.slice(SESSION_COOKIE_NAME.length + 1);
    if (!token || !(await verifySessionToken(token))) {
      throw new InputError("Bu işlem için oturum gerekli");
    }
    return;
  }
  assertLocalRequest(request);
}

/**
 * Yerel makineyi etkileyen mutasyonları (AI profilleri, doğrulama çağrıları)
 * localhost kökenli isteklerle sınırlar. Hesap sistemi yerine hafif sınır.
 */
export function assertLocalRequest(request: Request): void {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const isLocal =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1:") ||
    host === "[::1]";
  if (!isLocal) {
    throw new InputError("Bu işlem yalnızca localhost üzerinden yapılabilir");
  }
}
