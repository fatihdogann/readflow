/**
 * Sunucu başlangıç denetimleri. Production'da tek kullanıcı oturumu ZORUNLUDUR:
 * auth env değişkenleri eksikse uygulama açık ve anlaşılır hatayla durur —
 * korumasız yayına çıkmaz. Yerel geliştirmede (NODE_ENV!=='production') denetim yok.
 */
function fail(message: string): never {
  console.error(`[readflow] ${message}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  const username = process.env.READFLOW_AUTH_USERNAME?.trim();
  const password = process.env.READFLOW_AUTH_PASSWORD?.trim();
  if (!username || !password) {
    fail(
      "Production'da oturum zorunlu: READFLOW_AUTH_USERNAME ve READFLOW_AUTH_PASSWORD " +
        "tanımlı değil. .env.local'a ekleyip yeniden başlatın.",
    );
  }
  if (password.length < 10) {
    fail("READFLOW_AUTH_PASSWORD en az 10 karakter olmalı — zayıf şifreyle başlatma kapatıldı.");
  }
  if ((process.env.READFLOW_SESSION_SECRET?.trim().length ?? 0) < 32) {
    fail(
      "Production'da READFLOW_SESSION_SECRET zorunlu (en az 32 karakter). " +
        "Üret: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }
}
export {};
