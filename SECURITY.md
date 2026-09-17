# Güvenlik Politikası

## Desteklenen sürümler

Yalnızca `main` dalının en güncel hâli desteklenir.

## Açık bildirme

Güvenlik açıklarını **public issue olarak açmayın**. Bunun yerine:

- GitHub'da **Security → Report a vulnerability** (private vulnerability reporting), ya da
- [mehmetfatihdogan.com.tr/iletisim](https://mehmetfatihdogan.com.tr/iletisim)

Bildirime etkilenen sürüm/commit, yeniden üretme adımları ve olası etkiyi ekleyin.
İlk yanıt hedefi 7 gündür.

## Kapsam

Readflow tek kullanıcılı, yerelde çalışan bir uygulamadır. Tasarım gereği:

- Web sunucusu yalnızca `127.0.0.1` üzerinde dinler; uzak erişim Tailscale Serve gibi
  kimlik doğrulamalı bir katmanla sağlanır.
- Production'da oturum bilgileri ve `READFLOW_SESSION_SECRET` zorunludur.
- AI işleri kullanıcının kendi agent CLI'ı üzerinden çalışır; CLI'ın hangi sağlayıcıya
  veri gönderdiği Readflow'un kapsamı dışındadır.

Özellikle ilgilendiğimiz konular: URL indirmede SSRF atlatma, oturum/origin denetimi
atlatma, `/api/ingest` token sızıntısı, agent komutuna argüman/komut enjeksiyonu,
sanitize edilmiş HTML üzerinden XSS.
