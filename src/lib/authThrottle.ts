/**
 * Giriş denemesi sınırı — bellekte, istemci başına.
 *
 * Tek kullanıcılı ve tek süreçli bir uygulama olduğu için kayıt bellekte tutulur;
 * süreç yeniden başlarsa sayaç sıfırlanır (kabul edilebilir: saldırgan yeniden
 * başlatmayı tetikleyemez). Amaç parola denemesini pratikte imkânsız kılmak.
 */
export interface LoginThrottle {
  check: (key: string) => { blocked: boolean; retryAfterSeconds: number };
  fail: (key: string) => void;
  success: (key: string) => void;
  size: () => number;
}

export function createLoginThrottle({
  limit = 8,
  windowMs = 10 * 60_000,
  now = Date.now,
}: { limit?: number; windowMs?: number; now?: () => number } = {}): LoginThrottle {
  const attempts = new Map<string, { count: number; first: number }>();

  const sweep = (): void => {
    const cutoff = now() - windowMs;
    for (const [key, entry] of attempts) if (entry.first <= cutoff) attempts.delete(key);
  };

  return {
    check(key) {
      const entry = attempts.get(key);
      if (!entry) return { blocked: false, retryAfterSeconds: 0 };
      const elapsed = now() - entry.first;
      if (elapsed > windowMs) {
        attempts.delete(key);
        return { blocked: false, retryAfterSeconds: 0 };
      }
      if (entry.count < limit) return { blocked: false, retryAfterSeconds: 0 };
      return { blocked: true, retryAfterSeconds: Math.ceil((windowMs - elapsed) / 1000) };
    },
    fail(key) {
      sweep();
      const entry = attempts.get(key);
      if (!entry || now() - entry.first > windowMs) attempts.set(key, { count: 1, first: now() });
      else entry.count++;
    },
    success(key) {
      attempts.delete(key);
    },
    size: () => attempts.size,
  };
}

/** Uygulama genelinde tek örnek (route modülü yeniden yüklenmedikçe yaşar). */
export const loginThrottle = createLoginThrottle();

/** Ters proxy (Tailscale Serve) arkasında gerçek istemci adresi. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "bilinmeyen";
}
