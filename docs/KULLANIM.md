# Readflow — Günlük Kullanım

Kurulum burada değil, [INSTALL.md](INSTALL.md) dosyasında. Bu sayfa "kurdum, şimdi ne yapıyorum" sorusunun cevabı.

Komutların hepsi repo klasöründe çalışır:

```bash
cd ~/Developer/readflow
```

## Nereden açılır?

| Nerede | Adres |
|---|---|
| Mac'te | `http://127.0.0.1:3000` |
| Telefon / başka cihaz (Tailscale açıkken) | `https://<mac-adı>.<tailnet>.ts.net` |

Uygulama Mac açılınca kendiliğinden başlar. Telefondan erişmek için Mac'in açık ve Tailscale'in bağlı olması gerekir.

## Günlük akış

1. **İçerik ekle.** Ana sayfadaki kutuya bağlantı yapıştır, metin bırak veya dosya sürükle.
2. **Oku.** Belge sayfasında Orijinal sekmesi hiç değişmez. Okudukça altını çiz, kenara not düş.
3. **AI'a iş ver.** **Özetle** (Kısa/Normal/Detaylı) veya **Okunabilirliği Artır**. İş kuyruğa girer, worker CLI'ını çalıştırır, sonuç sekme olarak görünür.
4. **Dışa aktar.** Her çıktının **Dışa Aktar** menüsü var: kopyala, Markdown, TXT, DOCX, PDF.

## İçerik eklemenin beş yolu

| Yol | Ne zaman |
|---|---|
| Bağlantı yapıştır | Normal makaleler. Sunucu sayfayı indirip ana metne ayrıştırır. |
| Metin yapıştır | Kendi notların, bir yerden kopyaladığın bölüm. |
| Dosya bırak | PDF, Word, Markdown, düz metin. Birden fazla dosyayı birlikte bırakabilirsin. |
| Bookmarklet | Site bot koruması veya giriş istiyorsa. Sayfa senin tarayıcından gider, sunucu siteye hiç bağlanmaz. |
| Telefon paylaşım menüsü | iPhone'da Kestirme, Android'de paylaş menüsü. Kurulum: Ayarlar → Tarayıcıdan gönder. |

Bir bağlantı "403" veya "engellendi" hatası verirse Readflow önce Wayback kopyasını dener; o da yoksa bookmarklet'i kullan ya da hata kutusundaki alana sayfa kaynağını yapıştır.

## Taranmış PDF (OCR)

Metni seçilemeyen, yani görselden oluşan PDF'ler otomatik olarak OCR'dan geçer. Türkçe ve İngilizce okur, varsayılan sınır ilk 50 sayfadır.

Daha fazla sayfa için `~/.readflow/app.env` dosyasına ekle ve `pnpm app:install` ile servisi yeniden başlat:

```bash
READFLOW_OCR_MAX_PAGES=300
```

Uzun taramaları (yaklaşık 50 sayfa üstü) tarayıcıdan yüklemek yerine komutla ekle; tarayıcı isteği zaman aşımına uğrayabilir, komut satırında böyle bir sınır yok:

```bash
pnpm import:files ~/Downloads/taranmis-kitap.pdf
```

OCR'ı kapatmak için `READFLOW_OCR=off`. El yazısı için uygun değildir.

## Toplu içe aktarma

```bash
pnpm import:files ~/Documents/Notlar            # klasör: .md .txt .html .pdf .docx (alt klasörler dahil)
pnpm import:files ~/Downloads/instapaper.csv    # url sütunlu CSV: Instapaper, Pocket, Readwise
pnpm import:files ~/Downloads/bookmarks.html    # tarayıcı veya Pocket yer imi dışa aktarımı
```

- Bağlantılar sırayla indirilir, aralarında 1 saniye bekler.
- Arşivde zaten olan bağlantılar ve aynı içerikli belgeler atlanır; komutu tekrar çalıştırmak güvenlidir.
- Etiket sütunu varsa etiketler de aktarılır.
- Hata alan bağlantılar en sonda listelenir; onları bookmarklet ile tek tek ekleyebilirsin.

## Yedekleme ve taşıma

**Yedek al** (ikisi de aynı şeyi yapar):

```bash
pnpm db:backup
```

veya Ayarlar → **Yedeği indir**. Ayarlar ekranı son yedek 7 günü geçtiyse uyarır.

Yedekler `~/.readflow/backups/` altında birikir. Arada bir birini Mac dışına da kopyala; tek kopya yedek sayılmaz.

**Geri yükle veya başka bilgisayara taşı:**

```bash
pnpm app:uninstall                                # uygulama kapalı olmalı
pnpm db:restore ~/Downloads/readflow-….sqlite --check   # önce doğrula
pnpm db:restore ~/Downloads/readflow-….sqlite           # geri yükle
pnpm app:install
```

Geri yükleme mevcut veritabanını önce `backups/pre-restore-*.sqlite` olarak yedekler, sonra tablo sayılarının eşleştiğini doğrular.

## Bakım komutları

| Komut | Ne yapar |
|---|---|
| `pnpm diagnose` | Kurulumu baştan sona kontrol eder. Bir şey ters gittiğinde ilk çalıştıracağın komut. |
| `pnpm app:status` | Servis çalışıyor mu? |
| `pnpm app:logs` | Canlı log (çıkmak için Ctrl+C). |
| `pnpm app:uninstall` | Servisi durdurur ve kaldırır. Veriye dokunmaz. |
| `git pull && pnpm install && pnpm build && pnpm app:install` | Güncelleme. |

## Bir şeyler ters giderse

| Belirti | Yapılacak |
|---|---|
| Sayfa açılmıyor | `pnpm diagnose` → servis kurulu değilse `pnpm app:install`. |
| "Agent bağlı değil" | Terminalde `claude` (veya `codex`) yazıp oturum aç, sonra başarısız işte **Yeniden dene**. |
| Telefondan açılmıyor | Telefonda ve Mac'te Tailscale bağlı mı? Mac uyanık mı? |
| Özet gelmiyor | `pnpm app:logs` ile agent hatasına bak. |
| Bağlantı eklenmiyor | Bookmarklet'i kullan veya sayfa kaynağını yapıştır. |
| Taranmış PDF eklenmiyor | `pnpm diagnose` çıktısında OCR satırına bak; araçlar eksikse `brew install tesseract tesseract-lang poppler`. |

## Aklında kalsın

- Veriler yalnızca `~/.readflow/` içinde. Bu klasörü silersen arşiv gider.
- Uygulama yalnızca `127.0.0.1` adresini dinler; internete açık değildir, dışarıdan erişim yalnız Tailscale üzerinden ve girişle olur.
- "Yerelde saklama" ile "AI tamamen çevrimdışı" aynı şey değildir: özet üreten CLI, kendi oturumuyla uzak bir modele bağlanıyor olabilir.
- Silinen belgeler geri alınabilir; orijinal metin hiçbir zaman değişmez.
