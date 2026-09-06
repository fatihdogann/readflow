import { InputError } from "../types";

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
