# Readflow

Local-first, AI destekli kişisel okuma ve metin işleme alanı. Chatbot değil; **reader + article extractor + summarizer + archive + export workspace**.

<!-- TODO: Ekran görüntüleri buraya -->

```
Tarayıcı ──▶ Web uygulaması (localhost:3000)
                │  doküman + job yazar
                ▼
            SQLite (WAL)  ◀──  Yerel worker (job kuyruğu)
                ▲                    │ prompt via stdin / stdout
                └── çıktılar         ▼
                          Coding-agent CLI (claude / codex / jcode / …)
```

## Readflow nedir?

- Bir **URL yapıştırırsın**: sayfa sunucu tarafında indirilir, Mozilla Readability ile ana makaleye ayrıştırılır (navigation, reklam, cookie banner gürültüsü atılır, HTML sanitize edilir).
- Bir **metin yapıştırırsın**: doğrudan arşive kaydedilir.
- Sonra iki AI işlemi çalıştırırsın: **Okunabilirliği Artır** (yeniden yazım değil; sadece yapılandırma) ve **Özetle** (Kısa / Normal / Detaylı).
- AI işlemleri **remote LLM API'si ile değil**, kendi bilgisayarında açık olan coding-agent CLI üzerinden yapılır. **Hiçbir LLM API key istemez.**
- Her şey `~/.readflow/` altındaki tek bir SQLite dosyasında kalır. Geçmiş kalıcıdır; arama, favoriler, klasörler, etiketler ve domain filtresi ile gezilir.
- Çıktılar panoya, TXT, Markdown, PDF (yazdır), DOCX olarak yerel olarak dışa aktarılır; Notion/Telegram adapter'ları env ile kurulur.

## Gereksinimler

- Node.js 20.9+ (önerilen: 22/24 LTS)
- pnpm 9+
- AI işlemleri için: authenticated bir coding-agent CLI (`claude`, `codex`, `jcode`, …) **veya** MCP destekleyen bir agent
- GitHub CLI (`gh`) yalnızca repo oluşturmayı otomatikleştirmek istersen

## Kurulum

```bash
git clone <repo-url> readflow && cd readflow
pnpm install
pnpm db:migrate   # opsiyonel: ilk açılışta migration otomatik çalışır
```

## Geliştirme

```bash
pnpm dev:all      # web + worker birlikte
pnpm dev:web      # yalnızca web (localhost:3000)
pnpm dev:worker   # yalnızca job worker
pnpm dev:mcp      # MCP sunucusu (stdio) — agent konfigürasyonundan çalıştırılır
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm build        # production build
pnpm db:migrate   # şema sürümünü yazdırır
```

## Agent CLI bağlantısı

Worker, sıradaki `pending` job'ı alır; prompt'u agent CLI'nın **stdin**'ine yazar, sonucu **stdout**'tan okur.

**Sıfır yapılandırma:** `READFLOW_AGENT_CMD` boşsa worker bilinen CLI'ları (`claude`, `codex`, `jcode`) PATH'te arar, `--help` çıktısındaki non-interactive imzasını doğrular ve uygun olanı bağlar. Hiçbiri doğrulanamazsa site çalışmaya devam eder, job'lar `pending` kalır ve arayüzde **"Agent bağlı değil"** görünür; agent açıldığında bekleyen işler işlenir.

**Manuel bağlama** (`.env.local`):

```bash
READFLOW_AGENT_CMD="claude -p"          # prompt stdin'den, sonuç stdout'tan
READFLOW_AGENT_CMD="codex exec -"       # dizin git repo / trusted olmalı
READFLOW_AGENT_CMD="jcode run"          # jcode mesajı argüman ister: READFLOW_AGENT_PROMPT_VIA=argv
READFLOW_AGENT_TIMEOUT_MS=120000
```

Kendi script'in de olur — sözleşme basit: stdin → prompt, stdout → Markdown çıktı. Denemek için: `READFLOW_AGENT_CMD="node scripts/mock-agent.mjs"`.

## MCP kurulumu

MCP destekleyen agent'lara (ör. `.mcp.json`):

```json
{
  "mcpServers": {
    "readflow": {
      "command": "pnpm",
      "args": ["--dir", "/Users/sen/Desktop/Projeler/readflow", "dev:mcp"]
    }
  }
}
```

Tool'lar: `readflow_list_pending_jobs`, `readflow_get_job`, `readflow_claim_job`, `readflow_complete_job`, `readflow_fail_job`, `readflow_get_document`, `readflow_create_document`, `readflow_list_documents`. Böylece agent, Readflow'un kuyruğunu kendisi çekebilir (worker'a alternatif ikinci entegrasyon yolu).

## Yerel veri

- Veritabanı: `~/.readflow/readflow.sqlite` (WAL modu)
- `READFLOW_DATA_DIR` ile değiştirilebilir
- `.gitignore` yanlışlıkla oluşabilecek `*.sqlite*` ve veri dizinlerini repo dışında tutar

## Dışa aktarma

Her çıktı için **Dışa Aktar** menüsü: Panoya Kopyala, TXT, Markdown, PDF (tarayıcı yazdırma → PDF olarak kaydet; tamamen yerel), DOCX (yerelde üretilir). Notion ve Telegram için `.env.local` içine `READFLOW_NOTION_TOKEN`, `READFLOW_NOTION_DATABASE_ID`, `READFLOW_TELEGRAM_BOT_TOKEN`, `READFLOW_TELEGRAM_CHAT_ID` girilmeden butonlar uygulamanın geri kalanını bozmadan "kurulmadı" der.

## Gizlilik

Tüm veri (dokümanlar, çıktılar, job geçmişi) yalnızca `~/.readflow/` içinde durur, hiçbir cloud servise gitmez. Repoyu public yapmadan önce `.env.local` dosyası ve veri dizini Git'e asla girmez (gitignore koruması var); yine de `git log --diff-filter=A -- "*.sqlite*" "data/"` ile bir kontrol önerilir.

## Sorun giderme

- **"Agent bağlı değil"**: `READFLOW_AGENT_CMD` tanımla veya CLI'ının authenticated olduğundan emin ol (`claude` OAuth oturumu dolabilir — terminalden `claude doctor`).
- **better-sqlite3 kurulmuyor**: `pnpm rebuild better-sqlite3` — Node sürümün için prebuilt binary yoksa Xcode CLT gerekir.
- **codex "Not inside a trusted directory"**: worker'ı repo kökünden çalıştırdığından emin ol (varsayılan öyle) veya dizini codex'te trust et.
- **Port 3000 dolu**: `pnpm dev:web -- -p 3001`.
- **URL eklenemiyor (HTTP 403 vb.)**: bazı siteler bot engeli uygular; sayfayı kopyalayıp metin olarak yapıştır.

## Mimari

Readflow bağımsız süreçler halinde çalışır; hepsi aynı SQLite dosyasını **WAL** modunda paylaşır ve birbirine yalnızca veritabanı üzerinden konuşur:

| Süreç | Komut | Sorumluluk |
|---|---|---|
| Web uygulaması | `pnpm dev:web` | Next.js 16 (App Router): UI, REST API, URL extraction, export servisleri |
| Worker | `pnpm dev:worker` | `pending` job'ları atomik claim eder, agent CLI'ı çalıştırır, çıktıyı yazar |
| MCP sunucusu | `pnpm dev:mcp` | Coding agent'lara stdio üzerinden job/doküman tool'ları sunar |
| Agent CLI | senin makinen | AI işini gerçekleştiren `claude` / `codex` / `jcode` / özel script |

```
Tarayıcı ──▶ Web (Next.js) ──▶ documents + pending jobs
                                   │
             Worker ◀── claim (BEGIN IMMEDIATE, atomik)
               │  prompt → stdin, sonuç ← stdout
               ▼
          Agent CLI ──▶ document_outputs + completed jobs
                                   │
                     UI polling ──▶ sonuç otomatik görünür
```

### Veri modeli

| Tablo | İçerik |
|---|---|
| `documents` | Kaynak içerik: başlık, `source_type` (url/text), source_url/domain, yazar, yayın tarihi, `original_text`, sanitize edilmiş `original_html`, favorite, folder |
| `document_outputs` | AI çıktıları: `readability` veya `summary`; özette `summary_level` (short/normal/detailed). `UNIQUE(document, operation, level)` — aynı işlem yeniden çalıştırılırsa **upsert** olur, orijinal içerik asla overwrite edilmez |
| `jobs` | Kuyruk: status (`pending → processing → completed/failed`), attempts, error, zaman damgaları |
| `folders`, `tags`, `document_tags` | Arşiv organizasyonu (many-to-many etiketler, FK `ON DELETE CASCADE/SET NULL`) |
| `documents_fts` | FTS5 sanal tablosu (external content) + INSERT/UPDATE/DELETE trigger'ları ile senkron tam metin arama; SQLite derlemesinde FTS5 yoksa LIKE fallback |

Şema sürümü `meta` tablosunda tutulur; migration'lar `src/lib/db/migrations.ts` içinde transaction ile uygulanır (ORM yok — typed repo katmanı + prepared statement'lar).

### Job yaşam döngüsü (pending job protokolü)

1. UI `POST /api/jobs` der → `pending` satırı (aynı iş aktifse idempotent: yeni satır açılmaz).
2. Worker `claimNextJob` ile `BEGIN IMMEDIATE` transaction içinde claim eder: `pending → processing`, attempts+1. İki worker aynı anda çalışsa bile çift dağıtım olmaz.
3. Prompt `src/lib/ai/instructions` altındaki talimatlardan üretilir (80k karakter üstü kaynakta kısaltma notuyla), `AgentAdapter.run` çağrılır: prompt **stdin**'e yazılır, sonuç **stdout**'tan okunur, timeout'ta süreç SIGKILL'lenir.
4. Başarıda `completeJob` tek transaction'da çıktıyı upsert eder ve job'ı `completed` yapar; hatada job `failed` olur, hata mesajı UI'da görünür ve "Yeniden dene" ile tekrar kuyruğa alınabilir (attempts < 5).
5. Worker açılışta takılı kalmış `processing` job'ları geri `pending` yapar; her döngüde kalp atışını `meta`'ya yazar. `/api/agent/status` bu kalp atışından sidebar rozetini besler: *Agent hazır / Agent bağlı değil / İş işleniyor / Worker kapalı*.

### Katman sorumlulukları

```
src/lib/db              SQLite bağlantısı (WAL, FK, busy_timeout) · migration runner · repo'lar
src/lib/jobs            ReadflowWorker döngüsü · processJob · heartbeat
src/lib/agent           AgentAdapter sözleşmesi · CommandAgentAdapter (shellsiz spawn, tokenize edilmiş argv)
                        · MockAgentAdapter · detect (CLI'ları --help imzasıyla doğrulayan auto-detect)
src/lib/ai/instructions Okunabilirlik + Kısa/Normal/Detaylı özet talimatları (component'lara gömülü değil)
src/lib/extraction      fetchArticle (SSRF/timeout/boyut/redirect/content-type korumalı) · Readability · sanitize
src/lib/documents       createDocumentFromInput · getDocumentDetail
src/lib/export          format (Markdown/TXT) · docx (yerel üretim) · notion/telegram (env-gated adapter'lar)
src/mcp                 Yerel MCP sunucusu (stdio): kuyruk + doküman tool'ları
src/worker              Worker giriş noktası
src/app                 Next.js sayfaları + zod-doğrulamalı API route'ları
```

Katmanlar tek yönlü bağımlılıkla ayrışır: UI → servisler → repo'lar; agent/MCP/extraction/export birbirinin içine gömülü değildir. Yeni bir agent CLI'ı desteklemek yalnızca `src/lib/agent`, yeni bir export hedefi yalnızca `src/lib/export` dokunmayı gerektirir.

### Bir URL'nin yolculuğu

1. Textarea'da `https://…` algılanır (client + server çift kontrol) → `POST /api/documents {url}`.
2. `assertPublicHttpUrl`: yalnızca http(s), kimlik bilgisi ve private ağ adresleri (localhost, 127/8, 10/8, 192.168/16, 172.16-31, 169.254/16, .local, .internal…) reddedilir.
3. Fetch: 12 sn timeout, 5 MB gövde sınırı, en fazla 4 redirect (her adımda SSRF kontrolü tekrar), content-type html/xhtml/plain doğrulaması.
4. JSDOM + Mozilla Readability: başlık (makale h1'i tercih edilir), yazar, yayın tarihi, ana metin; görsel adresleri mutlaklaştırılır, `srcset` temizlenir.
5. `sanitize-html` allowlist: script/iframe/style ve event handler'ları düşer, linklere `rel="noopener noreferrer"` eklenir → `documents` tablosuna kayıt. Bu aşamada **AI kullanılmaz**.

### Güvenlik duruşu

- Remote LLM API'si yok; ağa çıkan tek yerler URL fetch'i ve opsiyonel Notion/Telegram entegrasyonlarıdır.
- `CommandAgentAdapter` shell çalıştırmaz: komut quote-duyarlı tokenizer ile parçalanıp doğrudan `spawn(program, args)` verilir; prompt hiçbir zaman argv'ya gömülü değil (stdin).
- AI çıktıları `react-markdown` ile render edilir (ham HTML çalıştırılmaz); URL'den gelen HTML zaten kayıt sırasında sanitize edildi.
- Credential'lar (Notion/Telegram) veritabanına yazılmaz, yalnızca environment'tan okunur.

Ayrıntı ve "projeyi çalıştır" protokolü için [AGENTS.md](AGENTS.md).

---

## Geliştirici

**Mehmet Fatih Doğan** — backend geliştirici, güvenlik meraklısı.

- 🌐 Portfolyo & iletişim: [mehmetfatihdogan.com.tr](https://mehmetfatihdogan.com.tr)
- 💻 GitHub: [@fatihdogann](https://github.com/fatihdogann)

Proje hakkında soru, hata bildirimi veya geri bildirim için [iletişim sayfamdan](https://mehmetfatihdogan.com.tr/iletisim) ulaşabilirsin.
