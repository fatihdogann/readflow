# Coolify dağıtım planı ve Mac AI worker (YOL HARİTASI — tamamen uygulanmadı)

> **Durum:** Bu belge hedef mimariyi, güvenlik modelini ve uygulama adımlarını tanımlar.
> Aşağıdaki "Henüz uygulanmadı" bölümündeki parçalar kodda **yoktur**; mevcut uygulama
> hâlâ tek makinede SQLite + yerel worker ile çalışır. Bu parçalar tamamlanmadan
> üretim dağıtımı yapılmamalıdır.

## Hedef mimari

```
Telefon / Masaüstü ──HTTPS──▶ Coolify: Next.js (production) + PostgreSQL
                                   │  jobs tablosu (merkezi kuyruk)
                                   ▲
MacBook ──outbound HTTPS──▶ /api/worker/* (claim / heartbeat / complete / fail / abort)
   └─ yerel worker + jcode/claude/codex CLI profilleri
```

- Web + veri Coolify'da; Mac'e inbound port/açık HTTP yok. Worker yalnızca dışarı
  doğru, token'lı HTTPS isteği açar (poll tabanlı claim; gecikme ≈ poll aralığı).
- SQLite asla ağ diski/Coolify volume'a bağlanmaz; veri bir kez içe aktarılır.

## Henüz uygulanmadı (bu parçalar kodda yok)

1. **PostgreSQL repository/migration katmanı** — `src/lib/db/**` şu an better-sqlite3.
   Gerekli: `pg` istemcili ikinci repo katmanı (ya da sorgu soyutlaması), migration
   runner'ın pg karşılığı, mevcut SQLite şemasının birebir DDL çevirisi
   (FTS5 → pg `tsvector`, `VACUUM INTO` yedeği → `pg_dump`).
2. **Worker remote protokolü** — `POST /api/worker/claim|heartbeat|complete|fail|cancel`
   uçları + `WORKER_ENROLLMENT_SECRET` (yalnız bu uçlara yetkili, döndürülebilir,
   web oturumu/Telegram secret'larından ayrı) + worker'ın HTTP client modu.
   Cancel'ın uzak süreci sonlandırması mevcut yerel `abort()` yolunu kullanır.
3. **SQLite → PostgreSQL içe aktarma aracı** — `scripts/import-sqlite-to-pg.ts`:
   önce `pnpm db:backup`, sonra idempotent yükleme + satır sayısı/örneklem doğrulaması.
4. **Chat** (merkezi PostgreSQL konuşma/mesaj modeli + chat iş türü + panel) — bu
   pivot tamamlandıktan sonra yapılacak.
5. **Vurgu/bağlam notları** (annotations tablosu + seçim araç çubuğu) — aynı şekilde.

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
