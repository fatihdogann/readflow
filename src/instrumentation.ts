/**
 * Sunucu başlangıç denetimleri. Production'da tek kullanıcı oturumu ZORUNLUDUR:
 * auth env değişkenleri eksikse uygulama açık ve anlaşılır hatayla durur —
 * korumasız yayına çıkmaz. Yerel geliştirmede (NODE_ENV!=='production') uyarı yeter.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  const username = process.env.READFLOW_AUTH_USERNAME?.trim();
  const password = process.env.READFLOW_AUTH_PASSWORD?.trim();
  if (!username || !password) {
    console.error(
      "[readflow] Production'da oturum zorunlu: READFLOW_AUTH_USERNAME ve " +
        "READFLOW_AUTH_PASSWORD tanımlı değil. Coolify environment'a ekleyip " +
        "yeniden başlatın; korumasız yayın güvenlik riskidir.",
    );
    process.exit(1);
  }
  if (password.length < 10) {
    console.error(
      "[readflow] READFLOW_AUTH_PASSWORD en az 10 karakter olmalı — zayıf şifreyle yayın kapatıldı.",
    );
    process.exit(1);
  }
  if (!process.env.WORKER_ENROLLMENT_SECRET?.trim()) {
    console.warn(
      "[readflow] WORKER_ENROLLMENT_SECRET tanımlı değil — Mac worker bağlanamaz (site yine de çalışır).",
    );
  }
}
