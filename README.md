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

## Mimari (kısa)

`src/lib/db` (SQLite + migration + repo) · `src/lib/jobs` (atomic job queue + worker) · `src/lib/agent` (AgentAdapter: command/mock/detect) · `src/lib/ai/instructions` (prompt'lar) · `src/lib/extraction` (fetch + Readability + sanitize) · `src/lib/export` (format/docx/notion/telegram) · `src/mcp` (MCP server) · `src/app` (Next.js UI). Ayrıntı ve "projeyi çalıştır" protokolü için [AGENTS.md](AGENTS.md).
