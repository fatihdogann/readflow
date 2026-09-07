# Readflow — Geliştirme Planı

Her faz tek başına sevk edilebilir. Faz sonunda `pnpm test && pnpm typecheck && pnpm lint` geçmeli,
dokunulan dokümantasyon aynı commit'te güncellenmeli.

---

## Faz 0 — Günlük kullanım engelleri ✅ TAMAMLANDI

Bunlar her gün canını sıkan şeyler; önce bunlar.

### 0.1 Mac worker elle başlatma bitsin

Bugün: `cd ~/Desktop/Projeler/readflow && pnpm worker:remote` + terminal açık kalacak.

- `scripts/install-worker-agent.sh` — macOS **launchd LaunchAgent** kurar
  (`~/Library/LaunchAgents/com.readflow.worker.plist`): açılışta başlar, çökerse
  `KeepAlive` ile geri gelir, log `~/.readflow/logs/worker.log`.
- Env (`READFLOW_SERVER_URL`, `READFLOW_WORKER_TOKEN`) plist'e değil `~/.readflow/worker.env`'e
  yazılır; `remote.ts` zaten `loadLocalEnv()` çağırıyor, oradan okur.
- `pnpm worker:install` / `pnpm worker:uninstall` / `pnpm worker:logs` script'leri.
- Uyku/uyanma ve ağ kopmasında `remote.ts` döngüsü zaten 5 sn'de bir yeniden deniyor — dokunma.

Kabul: Mac'i yeniden başlat, hiçbir komut yazmadan `/api/agent/status` → `workerAlive: true`.

### 0.2 Model önceliği: jcode → codex → claude (doğrulanmış bayraklarla)

Bugün iki sorun var:

1. Failover **yalnızca yerel worker'da** (`src/lib/jobs/worker.ts:83`). Senin çalıştırdığın
   `src/worker/remote.ts` içinde yok — yani zincir hiç devreye girmiyor.
2. Sıra yalnız CLI adına göre; model ve reasoning effort seçimi yok.

Yapılacak:

- `buildFallbackAdapters` mantığını `src/lib/jobs/` altında ortak bir yere al, `remote.ts`
  de kullansın (sunucudan gelen `aiConfig` + Mac'teki etkin profiller).
- `agent_profiles`'a `priority INTEGER` kolonu (yeni migration id 14) — sıra CLI adına değil
  bu kolona göre. Varsayılan seed:

  | Sıra | CLI | Model | Effort |
  |---|---|---|---|
  | 1 | jcode | `glm-5.3-flash` | — (aşağıya bak) |
  | 2 | codex | `gpt-5.6-terra` | `medium` |
  | 3 | claude | `opus-5` | `medium` |

- **Effort desteği** (şu an hiç yok) — `--help` ile doğrulandı, uydurma yok:
  - `claude`: `--effort medium` ✅ (`low, medium, high, xhigh, max`)
  - `codex`: `--effort` **yok**; `-c model_reasoning_effort="medium"` ✅ (senin
    `~/.codex/config.toml`'unda zaten bu anahtar var)
  - `jcode run`: effort/reasoning bayrağı **yok**, `model list`'te de `glm-5.3-flash`'ın
    `-max` varyantı yok. Yani "glm 5.3 flash max" şu an CLI'dan ifade edilemiyor.
    Plan: model'i `glm-5.3-flash` olarak kur, effort alanını jcode için pasif bırak.
    jcode bir gün bayrak eklerse `capabilities.ts` help regex'i kendiliğinden yakalar.
- `capabilities.ts`: `effortFlag` (claude) ve `configFlag` (codex `-c`) tespiti eklenir;
  `buildArgvForProfile` yalnız doğrulanmışsa bayrağı basar.
- Ayarlar ekranında profil kartları sürüklenip sıralanabilir + "effort" seçici (destekleyen CLI'da).

Test: `command.test.ts` + `capabilities.test.ts`'e üç CLI için argv beklentisi;
failover için "birincil hata → ikinci profil başarılı" testi.

### 0.3 İkonlar (favicon + mobil ana ekran)

Bugün: yalnız `src/app/icon.svg` (R harfi) + Next'in varsayılan `favicon.ico`'su. Manifest'te
tek SVG ikon var — **iOS ana ekranda SVG'yi kullanmaz**, sen mobilde ana ekrana ekleyeceğin
için ikon bozuk çıkar.

- `icon.svg`'deki R işaretinden üret: `favicon.ico` (16/32), `icon-192.png`, `icon-512.png`,
  `icon-512-maskable.png`, `apple-icon.png` (180×180, şeffaflık yok — iOS şeffafı siyah yapar).
- `manifest.ts`: PNG'ler + `purpose: "maskable"` varyantı.
- `layout.tsx` metadata: `appleWebApp: { capable: true, statusBarStyle: "default", title: "Readflow" }`
  ve `themeColor` açık/koyu tema için iki değer.
- Sidebar'daki "R" rozeti, favicon ve ana ekran ikonu aynı kaynaktan gelir — tek SVG, üretim script'i
  (`scripts/build-icons.mjs`, `sharp` yerine `resvg`/`sips` ile; yeni bağımlılık istemiyorsan `sips` yeter).

### 0.4 Güvenlik + veri kaybı

| İş | Dosya | Neden |
|---|---|---|
| SSRF: fetch öncesi `dns.lookup` + IP aralık kontrolü | `fetchArticle.ts` | Şu an yalnız hostname string'i bakılıyor; `evil.com → 127.0.0.1` geçiyor. Uygulama Coolify'da yayında, teorik değil. |
| Gerçek tarayıcı UA + `accept-language` + `referer` | `fetchArticle.ts:13` | UA'daki `Readflow/0.1` token'ı WAF'lara 403 verdiriyor. |
| Soft delete + "Geri al" | yeni migration, `repo/documents.ts`, `DocHeader.tsx` | `confirm()` + kalıcı silme; geri dönüş yok. |
| "Diğer" menüsü dışa tıklama / Esc ile kapansın | `DocHeader.tsx` | Native `<details>` açık kalıyor. |
| Header'daki "AI ayarları" linki kaldırılsın | `DocHeader.tsx` | Sidebar'da zaten var; başlık satırında 6 kontrol duruyor. |

---

## Faz 0.5 — Dokümantasyon temizliği ✅ TAMAMLANDI

Kod ilerledi, dokümanlar geride kaldı. Doğrulanan sapmalar:

| Doküman | Sorun |
|---|---|
| `README.md` | "Worker açılışta takılı `processing` job'ları `pending` yapar" — **yanlış**, artık yalnız süresi dolmuş lease kurtarılıyor (AGENTS.md doğru olanı yazıyor) |
| `README.md` | PDF export "tarayıcı yazdırma" deniyor; gerçekte `src/lib/export/pdf.ts` pdf-lib ile gerçek PDF üretiyor |
| `README.md` | Veri modeli tablosunda `annotations`, `chat_*`, `document_edits`, `document_output_revisions`, `agent_profiles` yok |
| `README.md` | Mimari bölümünde Coolify + `worker:remote` mimarisi hiç geçmiyor — senin gerçek kurulumun bu |
| `README.md` | Job yaşam döngüsü lease/snapshot'sız anlatılmış |
| `AGENTS.md` | "profil mutasyonları `assertLocalRequest` ile localhost'a kısıtlı" — artık `assertMutationAllowed` (auth farkında), Coolify için değişti |
| `readflow-kisisel-kullanim-plani.md` | İçindeki işlerin çoğu bitmiş (anlık filtreler, export içerik çözümleyici, PDF). **Sil.** |
| `COOLIFY-DEPLOY.md` | launchd bölümü eklenecek (Faz 0.1) |

---

## Faz 1 — Tek sağ raf

Bugün Not / Sohbet birbirini kapatıyor, Vurgular ise makalenin **en altında** kutu; uzun
makalede vurguna bakmak için sonuna kaydırıyorsun.

- `DocWorkspace.tsx`: `notesOpen`/`chatOpen` → tek `rail: "note" | "highlights" | "chat" | null`.
- Yeni `src/components/doc/RightRail.tsx`: sekme başlığı + gövde. İçerik olarak mevcut
  `NotesPanel` / `AnnotationList` / `ChatPanel` gövdeleri kullanılır, yeniden yazılmaz.
- `ContentTabs.tsx` altındaki "Vurgular (n)" `<section>` kaldırılır.
- Mobilde raf tek alt sayfa; üç panelin ayrı ayrı kopyaladığı focus-trap / `body.overflow` /
  Esc mantığı tek yerde toplanır.
- Sekme rozetleri: not var mı, vurgu sayısı, yanıt bekleyen soru sayısı.

Atlanan: sürüklenebilir genişlik, raf konumu tercihi.

---

## Faz 2 — Vurgu motoru + mobil

- **Touch**: `SelectionToolbar` yalnız `mouseup` dinliyor → **mobilde vurgu hiç çalışmıyor**.
  `touchend` + debounce'lu `selectionchange`.
- **Perf**: her `selectionchange`'te tüm metinde `findQuoteRange` koşuyor; uzun makalede
  sürükleme donuyor. 150 ms debounce, yalnız seçim bitince çalıştır.
- **Çift parse**: `HighlightedArticle` HTML'i hem `dangerouslySetInnerHTML` hem effect içinde
  `innerHTML` ile kuruyor.
- **Sahte range**: `ContentTabs` HTML yolunda `{start:0,end:0}` geçiyor → çakışma mantığı orada ölü.
- **Bağlanamayan alıntı görünsün**: düğümler arası seçim sessizce kayboluyor; listede
  "metinde bulunamadı" rozeti.
- **Araç çubuğu konumu**: sayfa tepesinde metnin üstüne biniyor (`y - 46` + `Math.max(8)`);
  yer yoksa seçimin altına açılsın.

Test: `annotations/match.test.ts`'e cross-node ve boşluk-normalizasyon vakaları.

---

## Faz 3 — Not + alıntı + AI (asıl hedef)

Altyapı var, UI bağlamıyor.

- **Alıntı gerçek alandan gitsin**: chat API `quote` + `includeNotes` kabul ediyor,
  `chat_messages.quote` kolonu var — `ChatPanel` hiç göndermiyor, alıntıyı input metnine
  string olarak yapıştırıyor. Sohbette alıntı ayrı "chip" olarak görünsün.
- **Vurgudan sor**: `HighlightPopover`'a "Bu alıntıyı AI'a sor" + "Notumu genişlet".
  Şu an yalnız yeni seçimden sohbete geçiliyor, mevcut vurgudan geçilemiyor.
- **Chat Markdown render**: mesajlar `whitespace-pre-wrap`, AI çıktıları `ReactMarkdown`.
  Aynı `MarkdownBlock`.
- **Ek not**: `NotesPanel`'e "+ ek not" — blob'un altına `---` + `**2026-09-07 14:20**`
  bloğu açıp imleci oraya koyar. Migration yok.
- **Düzenlenmiş sekmesinde vurgu**: DB/API `content_kind: "edited"` destekliyor, UI açmıyor.

---

## Faz 4 — Okuma akışı

- **Okuma durumu**: `documents.read_state` (`unread` / `reading` / `done`) — yeni migration,
  liste kartından ve başlıktan tek tıkla.
- **İlerleme + kaldığın yer**: scroll yüzdesi `localStorage`'a (`readflow:pos:<id>`),
  üstte ince ilerleme çubuğu. Sunucuya yazmaya gerek yok.
- **Ana sayfa**: "Okumaya devam et" (reading) + "Son eklenenler".
- **Liste kartı hızlı aksiyon**: favori + sil, belgeyi açmadan.
- **Toast**: satır içi `notice` metni kaydırınca kayboluyor; tek küçük toast bileşeni.

~~Okuma süresi tahmini~~ — istenmedi, çıkarıldı.

---

## Faz 5 — İçerik alma: her formattan, her siteden

Hedef: "yapıştırdığım hiçbir şey geri çevrilmesin."

### 5.1 Dosya formatları

Bugün `fetchArticle` content-type'ı html/xhtml/plain değilse reddediyor. Eklenecek:

| Format | Yol | Bağımlılık |
|---|---|---|
| PDF | `application/pdf` → metin + sayfa yapısı | `unpdf` (pdfjs sarmalayıcı, Node'da bağımsız çalışır). Mevcut `pdf-lib` **yazma** kütüphanesi, metin çıkaramaz. |
| DOCX | `mammoth` → HTML → mevcut sanitize + Readability yolu | `mammoth` |
| Markdown / TXT / RTF | doğrudan metin | yok |
| EPUB | zip + XHTML bölümleri | opsiyonel, sonra |

- Yeni `src/lib/extraction/fromBuffer.ts`: content-type + dosya imzasına (magic bytes) göre
  parser seç, çıktı yine `ArticleExtraction`. Boyut sınırı 5 MB → PDF için 25 MB'a çıkar.
- **Dosya yükleme**: ana formda "dosya sürükle/seç" — `POST /api/documents` `multipart/form-data`
  kabul eder. Telefondan PDF paylaşımı da böyle çalışır.
- Taranmış (görsel) PDF'te metin yoksa: net hata + "OCR gerekiyor" bilgisi. OCR şimdilik kapsam dışı.

### 5.2 403 / paywall / JS-site zinciri

- Sırayla: normal fetch → AMP sürümü → Wayback (`archive.org/wayback/available`) →
  başarısızsa **"HTML'i kendin yapıştır"** kaçış yolu.
- Hata mesajı sebebi söylesin ("site bot koruması döndürdü"), genel "indirilemedi" demesin.

### 5.3 Bookmarklet (kök çözüm)

- `public/bookmarklet.js`: açık sekmenin `document.documentElement.outerHTML`'ini
  `POST /api/documents`'e gönderir.
- `POST /api/documents`'e `html` + `sourceUrl` alanı eklenir → `extractFromHtml` doğrudan
  çağrılır, sunucu fetch etmez. Paywall, JS-render, çerez duvarı, oturum gerektiren sayfa: hepsi biter.
- Ayarlar'a "Bookmarklet'i sürükle" bölümü. iOS'ta Safari yer imi olarak çalışır.
- Extension **ancak** bookmarklet yetmezse.

---

## Faz 6 — Vurgu arşivi

- `/highlights`: tüm belgelerdeki vurgular; renk / etiket / belge filtresi; tıkla → belgede o noktaya git.
- Markdown export (mevcut `src/lib/export/registry.ts` üzerinden).
- "Seçili vurgulardan AI'a sor" — Faz 3'teki `quote` alanını çoklu alıntıyla kullanır.

---

## Yarım kalan işler (tespit edildi, fazlara dağıtıldı)

| # | Yarım kalan | Nerede biter |
|---|---|---|
| 1 | Failover zinciri yalnız yerel worker'da; `remote.ts`'te yok — yani hiç çalışmıyor | Faz 0.2 |
| 2 | Profillerde effort/öncelik kavramı yok | Faz 0.2 |
| 3 | Manifest'te yalnız SVG ikon — iOS ana ekran bozuk | Faz 0.3 |
| 4 | Chat `quote` + `includeNotes` API'de var, UI göndermiyor | Faz 3 |
| 5 | Annotation `content_kind: "edited"` DB/API'de var, UI'da yok | Faz 3 |
| 6 | `HighlightedArticle` sahte range + çift parse | Faz 2 |
| 7 | Mobil vurgu (touch event yok) | Faz 2 |
| 8 | Chat Markdown render etmiyor, AI çıktıları ediyor | Faz 3 |
| 9 | Non-HTML content-type reddediliyor (PDF/DOCX) | Faz 5.1 |
| 10 | Dokümantasyon 6 noktada koddan sapmış | Faz 0.5 |

---

## Kapsam dışı (şimdilik)

RSS/newsletter inbox · OCR · spaced repetition · çoklu kullanıcı · cloud sync ·
streaming yanıt · tarayıcı eklentisi (bookmarklet yetmezse).

---

## Sıra

```
Faz 0  ✅ (günlük kullanım: worker autostart · model zinciri · ikonlar · güvenlik)
Faz 0.5 ✅ (doküman temizliği)
Faz 1  (tek sağ raf)  ← sıradaki
Faz 2  (vurgu motoru + mobil)
Faz 3  (not + alıntı + AI)
Faz 4  (okuma akışı)
Faz 5  (PDF/Word/her format + 403 zinciri + bookmarklet)
Faz 6  (vurgu arşivi)
```

Faz 0 + 0.5 tek oturumda biter. Faz 1–3 birlikte "okuma deneyimi" sürümünü oluşturur;
sonrasında kullanıp eksik gördüğünle Faz 4+ yeniden sıralanır.
