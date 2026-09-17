# Coolify: statik vitrin

Coolify yalnızca `showcase/` klasöründeki statik TR/EN tanıtım sayfasını sunar.
Gerçek uygulama, SQLite ve AI worker Mac'te çalışır (`pnpm app:install`, bkz. README).
Vitrinde API, giriş, secret, veritabanı veya kalıcı volume **yoktur**.

## Kurulum

1. Coolify → **+ New Resource** → Private Repository (GitHub App) → bu repo, branch `main`.
2. Build Pack: **Static** (Nixpacks değil).
3. Base Directory: `/showcase` · Publish Directory: `/`.
4. Environment variables: **boş**. Persistent storage: **yok**.
5. Health check: path `/`, beklenen 200.
6. Önce geçici bir alan adıyla yayınla; mobil ve masaüstünde kontrol et.
7. Eski Readflow uygulamasından `readflow.mehmetfatihdogan.com.tr` alan adını kaldır, yeni kaynağa ekle.
8. Eski uygulamayı, `/data` volume'unu ve secret'larını (`WORKER_ENROLLMENT_SECRET`, `READFLOW_AUTH_*`) sil.

## Güvenlik başlıkları (Custom Nginx Configuration)

Sayfalarda CSP `<meta>` ile verilir. Kalan başlıklar için Coolify'da kaynağın
**Custom Nginx Configuration** alanındaki `location /` bloğuna ekle:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Strict-Transport-Security "max-age=31536000" always;
```

## Kesim sonrası kontrol

```bash
for p in / /en/ /robots.txt /sitemap.xml /login /api/health /api/worker /api/auth/status /api/ingest; do
  printf '%-20s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://readflow.mehmetfatihdogan.com.tr$p")"
done
```

Beklenen: ilk dört satır `200`, geri kalanı `404`.

## Vitrin görüntülerini yenileme

Görüntüler demo verisiyle alınır (`showcase/assets/*.jpg`, 1280×800 @2x, açık/koyu).
Arayüz değiştiğinde demo veri dizini ve `READFLOW_AGENT_CMD` ile sahte bir agent
kullanarak production build üzerinden Playwright ile yeniden çekilir.
