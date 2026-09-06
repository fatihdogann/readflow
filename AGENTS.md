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
src/lib/extraction/  URL fetch (timeout/boyut/redirect/SSRF kontrolleri) + Readability + sanitize
src/lib/export/      format (md/txt), docx, notion/telegram adapter'ları (env-gated)
src/lib/documents/   createDocumentFromInput + getDocumentDetail servisleri
src/mcp/             yerel MCP sunucusu (stdio) — web core'una gömülü değildir
src/worker/          worker giriş noktası (pnpm dev:worker)
src/app/             Next.js App Router UI + API route'ları
scripts/             migrate, mock-agent.mjs
```

## Veri

- Veri dizini: `~/.readflow/` (env: `READFLOW_DATA_DIR`), DB: `readflow.sqlite` (WAL, foreign_keys ON).
- **Kullanıcı verisi asla Git'e girmez.** `*.sqlite*`, `.env.local`, `data/`, `exports/` zaten ignore'da; yeni bir kalıcı veri yolu eklersen gitignore'u güncelle.
- Şema değişikliği = `src/lib/db/migrations.ts` içine **yeni, artan id'li migration** ekle; mevcutları asla düzenleme. Şema sürümü `meta` tablosunda tutulur; migration'lar transaction içinde uygulanır.

## Pending job protokolü

1. UI `POST /api/jobs` → `jobs` tablosuna `pending` satırı (aynı iş aktifse idempotent).
2. Worker `claimNextJob` ile `BEGIN IMMEDIATE` transaction içinde atomik claim yapar (`pending → processing`, attempts+1). Aynı job iki worker'a dağıtılamaz.
3. Prompt `src/lib/ai/instructions`'tan üretilir; agent adapter çalışır; başarısında `document_outputs` upsert edilir (UNIQUE: document+operation+level) ve job `completed` olur. **Orijinal içerik hiçbir zaman AI çıktısıyla overwrite edilmez.**
4. Hata durumunda job `failed` + hata mesajı; UI'dan yeniden denenebilir (attempts < 5).
5. Worker açılışta takılı `processing` job'ları `pending`'e geri alır. Agent yoksa worker idler, job'lar `pending` kalır — site çalışmaya devam eder.

## "Projeyi çalıştır" dediğinde

1. `node -v` ≥ 20.9 ve `pnpm -v` mevcut mu kontrol et; değilse kur.
2. `pnpm install` (bağımlılık değişikliği olup olmadığına bakmadan çalıştırmak güvenli).
3. Migration otomatik uygulanır (ilk DB açılışında); `pnpm db:migrate` ile sürümü doğrula.
4. `pnpm dev:all` ile web + worker'ı başlat (ya da ayrı ayrı `pnpm dev:web` + `pnpm dev:worker`).
5. Doğrula: `curl -s localhost:3000/api/agent/status` → `workerAlive: true`; `curl -s -o /dev/null -w "%{http_code}" localhost:3000` → 200. Agent bağlı değilse README'deki `READFLOW_AGENT_CMD` bölümünü kullanıcıya göster.

## Komutlar

`pnpm dev:all` · `pnpm dev:web` · `pnpm dev:worker` · `pnpm dev:mcp` · `pnpm db:migrate` · `pnpm build` · `pnpm start` · `pnpm test` · `pnpm typecheck` · `pnpm lint`

Testler vitest; test'ler geçici dizinde kendi SQLite'ını kurar (`src/lib/db/testDb.ts`), ağa bağlanmaz (URL extractor için `src/lib/extraction/__fixtures__/` fixture'ları var). Yeni özellik → önce core'a test.

## Agent entegrasyonu notları

- Adapter seçimi: `READFLOW_AGENT_MODE` (auto/command/mock/none) → `READFLOW_AGENT_CMD` → bilinen CLI preset'leri (`claude -p`, `codex exec -`, `jcode run`+argv; her preset kendi `--help` imzası doğrulanırsa kullanılır). CLI bayrakları **tahmin edilmez**.
- MCP yolu: `pnpm dev:mcp` stdio konuşur; tool'lar job queue'ya ve dokümanlara adapter düzeyinde erişir (`src/mcp/server.ts`). MCP'ye yeni tool eklerken iş mantığını `src/lib/db/repo`'da tut.
- `src/lib/extraction/fetchArticle.ts` SSRF kontrolleri içerir (private host/protocol/redirect/size sınırları) — gevşetme.
