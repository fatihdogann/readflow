# Coolify dağıtımı ve Mac AI worker

> **Durum (güncel):** Remote worker protokolü **uygulandı** (`/api/worker` + `src/worker/remote.ts` +
> `pnpm worker:remote`) ve **Dockerfile** hazır — Coolify'a repo bağlanıp dağıtılabilir.
> Merkezi kuyruk şu an **SQLite (volume üstünde)** ile çalışır; **PostgreSQL geçişi ve
> SQLite→PG içe aktarma aracı henüz uygulanmadı** (aşağıda plan). Chat de bu geçişten sonra.

## Hızlı dağıtım (mevcut durum)

1. Coolify → New Resource → Dockerfile tabanlı deploy (repo: fatihdogann/readflow, main).
2. Environment (Coolify secrets):
   - `READFLOW_AUTH_USERNAME` + `READFLOW_AUTH_PASSWORD` → siteye tek kullanıcı girişi
     (girilmezse site şifresiz açık çalışır — yerel kullanım). Oturum HttpOnly imzalı
     cookie; mutasyonlarda origin denetimi vardır. Ayrı `READFLOW_SESSION_SECRET`
     verilirse imza onunla yapılır (parola değişince oturumlar düşmesin istersen kullan).
   - `WORKER_ENROLLMENT_SECRET=<uzun rastgele değer>` (Mac worker için)
   - `READFLOW_TELEGRAM_BOT_TOKEN`, `READFLOW_TELEGRAM_CHAT_ID` (opsiyonel)
   - `READFLOW_DATA_DIR=/data` (Dockerfile'da varsayılan; Coolify volume'u `/data`'ya bağla)
3. Domain + HTTPS: Coolify domain ekleyin; **Basic Auth** açın (ilk güvenlik katmanı).
4. Health check: `GET /api/worker` → `{"ok":true,"enrollmentConfigured":...}`.
5. Mac worker — **kalıcı kurulum (önerilen)**: elle komut çalıştırmaya gerek yok.
   ```bash
   pnpm worker:install
   ```
   İlk çalıştırma `~/.readflow/worker.env` şablonunu oluşturur; `READFLOW_SERVER_URL`
   ve `READFLOW_WORKER_TOKEN` doldurulup komut tekrarlanır. Sonrası launchd servisi:
   Mac açılışında başlar, çökerse/ağ dönünce geri gelir.
   ```bash
   pnpm worker:status     # servis durumu
   pnpm worker:logs       # canlı log (~/.readflow/logs/worker.log)
   pnpm worker:uninstall  # servisi kaldır
   ```
   Tek seferlik/ön plan çalıştırma hâlâ mümkün:
   ```
   READFLOW_SERVER_URL=https://<domain> \
   READFLOW_WORKER_TOKEN=<WORKER_ENROLLMENT_SECRET ile aynı> \
   pnpm worker:remote
   ```
   - Mac CLI oturumları (jcode/claude/codex) kullanıcının kendi oturumunda doğrulanır.
   - `READFLOW_AGENT_CMD` ile Mac tarafında zorlama yapılabilir; yapılırsa Ayarlar
     "Environment tarafından yönetiliyor" gösterir (sunucu env'si değil, worker env'si).
   - Yerel test: sunucu + worker aynı makinedeyken `READFLOW_WORKER_ALLOW_PRIVATE=1`.
   - **Failover:** birincil profil hata verirse worker, sunucudan gelen yedek zinciri
     (Ayarlar'daki profil sırası) sırayla dener; iptal edilirse zincir durur.
6. Kuyruk davranışı: Mac kapalıyken işler `pending` bekler (UI: "Agent bağlı değil");
   worker bağlanınca claim + lease devralır. Uygulama güncellemesi (redeploy) worker'ı
   etkilemez; worker yalnızca HTTP konuşur.

## Henüz uygulanmadı

1. **PostgreSQL repository/migration katmanı** — `src/lib/db/**` şu an better-sqlite3.
   SQLite volume'da tek app-instance ile çalışır; pg geçişi için `pg` repo katmanı +
   migration runner + FTS (tsvector) karşılığı gerekli.
2. **SQLite → PostgreSQL içe aktarma aracı** — `scripts/import-sqlite-to-pg.ts`
   (önce `pnpm db:backup`, sonra idempotent yükleme + doğrulama).
3. **Belgeye bağlı AI chat** (merkezi konuşma/mesaj modeli + chat iş türü + panel).

## Hedef mimari (pg geçişi sonrası)

```
Telefon / Masaüstü ──HTTPS──▶ Coolify: Next.js (production) + PostgreSQL
                                   │  jobs tablosu (merkezi kuyruk)
                                   ▲
MacBook ──outbound HTTPS──▶ /api/worker (claim / heartbeat / complete / fail / cancel-ack)
   └─ yerel worker + jcode/claude/codex CLI profilleri
```

## Güvenlik katmanları

1. Coolify reverse-proxy Basic Auth (IP allowlist tek başına kullanılmaz).
2. Uygulama içi tek kullanıcı oturumu + mutasyonlarda origin denetimi (pg geçişiyle birlikte).
3. Worker uçları ayrı yetki sınırı: `WORKER_ENROLLMENT_SECRET` (timing-safe karşılaştırma,
   yalnız worker uçlarına erişir; web oturumu/Telegram secret'larından ayrı).
4. Secret'lar yalnız Coolify environment'ta; log/metadata'ya asla yazılmaz.

## Mac worker: launchd (üretimde)

`~/Library/LaunchAgents/com.readflow.worker.plist`: `ProgramArguments` →
`/usr/bin/env READFLOW_SERVER_URL=... READFLOW_WORKER_TOKEN=... <repo>/node_modules/.bin/tsx <repo>/src/worker/remote.ts`,
`KeepAlive` + `RunAtLoad` + `StandardOutPath/StandardErrorPath`. CLI oturumları kullanıcı
oturumunda doğrulanmalı; PATH için tam yollar kullanılır.

## Coolify kurulum adımları (1-3 tamamlandığında)

1. **Kaynak:** GitHub repo `fatihdogann/readflow`, build: `pnpm install --frozen-lockfile && pnpm build`,
   start: `pnpm start`. Node 22 image.
2. **Environment (Coolify secrets, Git'e girmez):**
   - `DATABASE_URL=postgres://...` (Coolify Postgres servisi, private network)
   - `READFLOW_DATA_DIR=/app/data` (yalnızca yedek/dosya exportları için volume)
   - `WORKER_ENROLLMENT_SECRET=<üret-ve-döndür>`
   - `READFLOW_TELEGRAM_BOT_TOKEN`, `READFLOW_TELEGRAM_CHAT_ID`
   - `READFLOW_SESSION_SECRET` (tek kullanıcı oturumu için)
3. **Domain/HTTPS:** Coolify domain + Let's Encrypt; **Basic Auth** ilk katman olarak
   Coolify proxy'den açılır (kullanıcı adı/parola secret olarak).
4. **Health check:** `GET /api/agent/status` 200 dönerse sağlıklı sayılır.
5. **Rollback:** Coolify deploy history'den önceki imaja dön; migration'lar geriye
   uyumlu yazıldığından (yalnız ADD COLUMN/CREATE) eski imaj yeni şemayla çalışır.

## Güvenlik katmanları

1. Coolify reverse-proxy Basic Auth (IP değişebilen mobil için kalıcı çözüm değil,
   IP allowlist tek başına kullanılmaz).
2. Uygulama içi tek kullanıcı oturumu: kullanıcı adı + uzun parola → HttpOnly,
   Secure, SameSite=Lax cookie; mutasyonlarda origin denetimi (mevcut
   `assertLocalRequest`'ın yerine "yetkili oturum VEYA güvenilir proxy origin" geçer).
3. Worker uçları ayrı yetki sınırı: yalnız `WORKER_ENROLLMENT_SECRET`.
4. Secret'lar yalnız Coolify environment'ta; log/metadata'ya asla yazılmaz.

## Mac worker: launchd (3 tamamlandığında)

`~/Library/LaunchAgents/com.readflow.worker.plist`:

- `ProgramArguments`: `/usr/bin/env READFLOW_DATA_DIR=$HOME/.readflow WORKER_SERVER_URL=https://<domain> WORKER_ENROLLMENT_SECRET=<secret> <repo>/node_modules/.bin/tsx <repo>/src/worker/remote.ts`
- `KeepAlive`, `RunAtLoad`, `StandardOutPath/StandardErrorPath` (log rotasyonu için
  harici: logları haftalık `logrotate` benzeri script'le kırp).
- CLI oturumları: jcode/claude/codex OAuth oturumları kullanıcı oturumunda açılmalı;
  launchd PATH'i için tam yollar kullanılır.

Mac kapalıyken işler kuyrukta "Mac worker bekleniyor" durumunda bekler; worker
bağlanınca lease mekanizması mevcut işi güvenle devralır (bu garanti şu anki
lease/sahiplik modeliyle zaten sağlanıyor).

## Sıra önerisi

1. pg repo katmanı + migration runner + testler (geçici Postgres konteyneriyle)
2. worker remote protokolü + enrollment + worker HTTP modu
3. içe aktarma aracı + doğrulama
4. Coolify ilk dağıtım + Basic Auth + health check
5. launchd kurulumu (kullanıcı onayıyla)
6. chat + vurgu notları
