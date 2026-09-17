# Readflow — Agent Rehberi

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Bu proje ne?

Readflow, **local-first** kişisel okuma/metin işleme uygulamasıdır: URL veya metin alır, arşivler, AI ile okunabilirlik düzenlemesi ve özet (Kısa/Normal/Detaylı) üretir, çıktıları dışa aktarır.

**Kritik kural:** Remote LLM API'si (OpenAI/Anthropic/Gemini/…) **kullanılmaz**, Supabase/kullanıcı hesabı yoktur. AI işleri, kullanıcının kendi makinesindeki coding-agent CLI üzerinden çalışır: web arayüzü SQLite'a `pending` job yazar, yerel worker bunu alır, agent CLI'yı çalıştırır (prompt → stdin, sonuç ← stdout), çıktıyı SQLite'a yazar. Kimlik doğrulama, cloud sync, ödeme gibi özellikler bilinçli olarak kapsam dışıdır.

## Mimari harita

```
src/lib/db/          SQLite bağlantısı (WAL), migrations.ts (sürüm meta tablosunda), repo/ (documents, jobs, outputs, folders, tags, meta)
src/lib/jobs/        job queue yardımcıları + ReadflowWorker döngüsü (kalp atışı meta'ya yazılır)
src/lib/agent/       AgentAdapter sözleşmesi; CommandAgentAdapter (stdin/stdout, shell yok), MockAgentAdapter, detect (CLI --help imza doğrulaması)
src/lib/ai/instructions/  Tüm prompt'lar burada — React component'larına asla gömme
src/lib/import/      toplu içe aktarma (klasör, url'li CSV, yer imi HTML'i) — createDocumentFromInput üzerinden
src/lib/extraction/  URL fetch (timeout/boyut/redirect/SSRF+DNS kontrolleri, 403'te Wayback yedeği) + Readability + sanitize + fromBuffer (PDF/DOCX/metin) + ocr (sistem tesseract/pdftoppm, npm bağımlılığı yok)
src/lib/export/      format (md/txt), docx, notion/telegram adapter'ları (env-gated)
src/lib/documents/   createDocumentFromInput + getDocumentDetail servisleri
src/mcp/             yerel MCP sunucusu (stdio) — web core'una gömülü değildir
public/bookmarklet.js  tarayıcıdan gönderme kaynağı; /api/bookmarklet token gömüp javascript: bağlantısına çevirir
src/worker/          worker giriş noktası (pnpm dev:worker)
src/app/             Next.js App Router UI + API route'ları
scripts/             migrate, mock-agent.mjs
```

## Veri

- Veri dizini: `~/.readflow/` (env: `READFLOW_DATA_DIR`), DB: `readflow.sqlite` (WAL, foreign_keys ON).
- **Kullanıcı verisi asla Git'e girmez.** `*.sqlite*`, `.env.local`, `data/`, `exports/` zaten ignore'da; yeni bir kalıcı veri yolu eklersen gitignore'u güncelle.
- Şema değişikliği = `src/lib/db/migrations.ts` içine **yeni, artan id'li migration** ekle; mevcutları asla düzenleme. Şema sürümü `meta` tablosunda tutulur; migration'lar transaction içinde uygulanır.

## Pending job protokolü (lease + snapshot)

1. UI `POST /api/jobs` → `createJobWithSnapshot`: **kaynak metin** (Otomatik = Düzenlenmiş varsa o, yoksa Orijinal), **dahil edilen notlar** (varsayılan hariç) ve **AI yapılandırması** (env kilidi > açık profil > varsayılan profil > otomatik) job satırına snapshot olarak yazılır. Aynı anahtarlı aktif iş varsa idempotent davranır; `forceNew` ile eski aktif iş iptal edilip yenisı açılır (partial UNIQUE index `idx_jobs_active_unique` koruması).
2. Worker/MCP `claimNextJob`/`claimJobById` ile `BEGIN IMMEDIATE` transaction içinde **owner + lease** atar. Aynı iş iki tüketiciye dağıtılamaz.
3. Prompt **snapshot'taki** metinden `buildPromptForSnapshot` ile üretilir; worker güncel belgeyi yeniden okumaz. Uzun işlerde heartbeat interval'i hem kalp atışını yazar hem lease'i yeniler.
4. Başarıda `completeJob` sahipliği doğrular, `document_outputs`'u upsert eder ve **değişmez `document_output_revisions`** satırı ekler. Sahiplik değiştiyse geç gelen sonuç reddedilir. Hata → `failed` + mesaj; UI retry aynı snapshot'ı kullanır (attempts < 5).
5. Kurtarma yalnızca `recoverExpiredLeases` ile **süresi dolmuş** işleredir; açılışta toplu `processing→pending` YOKTUR. Agent yoksa uygun olmayan iş `releaseJob` ile attempts bozmadan kuyruğa döner.

## İçerik türleri ve değişmezlik

- `documents.original_text` / `original_html` ilk kayıttan sonra **asla değişmez**.
- Silme geri alınabilir: `documents.deleted_at` doldurulur (`softDeleteDocument`), tüm listeler/arama/sayaçlar bunu süzer. Kalıcı `deleteDocument` yalnızca çöpü temizlemek içindir.
- Kullanıcı sürümü `document_edits` tablosunda (revision + optimistic concurrency; uyumsuz revision → 409). AI çıktıları `document_outputs` + `document_output_revisions`. Elle düzenleme asla sahte AI job'ı olarak modellenmez.
- Vurgular (`document_annotations`) metnin içine yazılmaz; alıntı + önek/sonek bağlamıyla saklanır ve okuma sırasında eşleştirilir. Orijinal HTML yolunda DOM'da `<mark>` sarılır, Markdown yollarında `rehypeHighlights` ile AST'ye eklenir — React'ın yönettiği ağaca sonradan düğüm sokulmaz.
- Notlar (`documents.note`) varsayılan AI'a gönderilmez; yalnızca iş bazında açıkça dahil edilirse snapshot'a girer ve prompt'a "ek bağlam" bloğu olarak eklenir.

## AI profilleri

- `agent_profiles` tablosu: görünen ad, cli (claude/codex/jcode), model/provider, `effort`, `priority` (failover sırası), transport (stdin/argv), timeout, enabled, `config_revision`, doğrulama bilgileri. Varsayılan profil `meta.default_agent_profile_id`.
- Yetenek çıkarımı `src/lib/agent/capabilities.ts`: CLI'ların gerçek `--help` çıktısından regex doğrulaması — **bayrak uydurma**; doğrulanmayan bayrak argv'ya eklenmez. argv üretimi yalnızca `buildCommandForProfile` üzerinden (serbest executable UI'dan kabul edilmez; custom komut yalnız env).
- Worker, işin snapshot'ındaki profil alanlarından adapter kurar; profil sonradan değişse/silinse eski iş kendi yapılandırmasıyla çalışır. meta/provenance alanları güvenli: raw komut, token, env değeri loglanmaz (`provenanceFor`).
- Profil mutasyonları ve doğrulama çağrıları `assertMutationAllowed` ile korunur: oturum yapılandırılmışsa (Coolify) geçerli oturum cookie'si yeterli, yapılandırılmamışsa (yerel geliştirme) yalnızca localhost. Doğrulama örnek metin kullanır, kullanıcı belgesi göndermez.
- Yetenekler **Mac worker'ın raporundan** okunur (`effectiveCapabilities`): Coolify container'ında CLI kurulu olmadığı için sunucu tespiti boş döner. Profil oluşturma/güncelleme bu fonksiyondan geçmeli.
- Failover: birincil profil hata verirse `orderedFallbackConfigs` sırası (profil `priority` kolonu) denenir. Sıra sunucuda üretilir, argv Mac'te; hem `src/lib/jobs/worker.ts` hem `src/worker/remote.ts` aynı sırayı kullanır.
- Reasoning effort yalnızca `--help` ile doğrulanmış yoldan geçer: `claude --effort`, `codex -c model_reasoning_effort="…"`. jcode'da effort bayrağı yoktur — değer saklanır, argv'ye girmez.

## Ortam değişkenleri

- `src/lib/env.ts > loadLocalEnv()` worker/MCP/migration/backup girişlerinde çağrılır (`.env` + `.env.local`, mevcut env ezilmez). Web sürecinin env yüklemesine güvenme — yeni entrypoint'larda loadLocalEnv'i çağır.

## "Projeyi çalıştır" dediğinde

1. `node -v` ≥ 20.9 ve `pnpm -v` mevcut mu kontrol et; değilse kur.
2. `pnpm install` (bağımlılık değişikliği olup olmadığına bakmadan çalıştırmak güvenli).
3. Migration otomatik uygulanır (ilk DB açılışında); `pnpm db:migrate` ile sürümü doğrula.
4. `pnpm dev:all` ile web + worker'ı başlat (ya da ayrı ayrı `pnpm dev:web` + `pnpm dev:worker`).
5. Doğrula: `curl -s localhost:3000/api/agent/status` → `workerAlive: true`; `curl -s -o /dev/null -w "%{http_code}" localhost:3000` → 200. Agent bağlı değilse README'deki `READFLOW_AGENT_CMD` bölümünü kullanıcıya göster.

## Komutlar

`pnpm dev:all` · `pnpm dev:web` · `pnpm dev:worker` · `pnpm dev:mcp` · `pnpm db:migrate` · `pnpm db:backup` · `pnpm db:restore <dosya> [--check]` · `pnpm import:files <yol>` · `pnpm diagnose` · `pnpm build` · `pnpm start` · `pnpm test` · `pnpm typecheck` · `pnpm lint`

Mac production (web 127.0.0.1 + yerel worker, uzak erişim Tailscale Serve): `pnpm app:start` · `pnpm app:install` (launchd, env `~/.readflow/app.env`) · `pnpm app:status` · `pnpm app:logs` · `pnpm app:uninstall`. İkon seti logo değişince: `pnpm icons`.

Testler vitest; test'ler geçici dizinde kendi SQLite'ını kurar (`src/lib/db/testDb.ts`), ağa bağlanmaz (URL extractor için `src/lib/extraction/__fixtures__/` fixture'ları var). Yeni özellik → önce core'a test.

## Agent entegrasyonu notları

- Adapter seçimi: `READFLOW_AGENT_MODE` (auto/command/mock/none) → `READFLOW_AGENT_CMD` → bilinen CLI preset'leri (`claude -p`, `codex exec -`, `jcode run`+argv; her preset kendi `--help` imzası doğrulanırsa kullanılır). CLI bayrakları **tahmin edilmez**.
- MCP yolu: `pnpm dev:mcp` stdio konuşur; tool'lar job queue'ya ve dokümanlara adapter düzeyinde erişir (`src/mcp/server.ts`). MCP'ye yeni tool eklerken iş mantığını `src/lib/db/repo`'da tut.
- Doküman girişi dört yoldan olur: URL (sunucu indirir), düz metin, dosya yükleme (multipart; PDF/DOCX/metin) ve `html` alanı (bookmarklet veya elle yapıştırma — sunucu siteye istek atmaz). Hepsi `createDocumentFromInput` üzerinden geçer.
- `/api/ingest` bookmarklet ve iOS Kestirmeler ucudur (`html` | `url` | `text`; bağlantı gibi görünen `text` URL yoluna gider): oturum cookie'si yerine `meta.ingest_token` taşıyıcı token'ı kullanır (cross-origin POST'ta SameSite=Lax cookie gitmez) ve `proxy.ts` oturum sınırının dışındadır. Token'ı döndüren `/api/bookmarklet` ise oturum ister — bilinçli olarak `/api/ingest` altında değildir.
- `src/lib/extraction/fetchArticle.ts` SSRF kontrolleri içerir: protokol/hostname allowlist **artı** her istek öncesi `dns.lookup` ile gerçek IP doğrulaması (rebinding'e karşı), redirect ve boyut sınırları — gevşetme.
