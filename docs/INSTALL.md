# Readflow Kurulumu

Readflow tek kullanıcılı ve yereldir: uygulama, veritabanı ve AI worker aynı bilgisayarda çalışır.
Ayrıntılı rehber macOS içindir; Linux ve Windows farkları en altta.

## 1. Gereksinimler

```bash
node -v        # v22 veya üstü
corepack enable
pnpm -v
```

Node yoksa: [nodejs.org](https://nodejs.org) (LTS) ya da `brew install node`.

## 2. Kodu indir ve derle

```bash
cd ~/Desktop/Projeler            # repo nerede duracaksa
git clone https://github.com/fatihdogann/readflow.git
cd readflow
pnpm install
pnpm build
```

Bundan sonraki bütün `pnpm` komutları **bu klasörde** (`readflow/`) çalıştırılır.

## 3. Ayar dosyası

Servis ayarları repo dışında durur: `~/.readflow/app.env`. İlk kez `pnpm app:install`
çalıştırıldığında boş şablon oluşturulur ve komut durur. Dosyayı aç:

```bash
open -e ~/.readflow/app.env
```

Doldur:

```bash
READFLOW_AUTH_USERNAME=kullanici-adin
READFLOW_AUTH_PASSWORD='en-az-10-karakterli-guclu-parola'
READFLOW_SESSION_SECRET=...   # aşağıdaki komutun çıktısı
```

Secret üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Özel karakter içeren değerleri tek tırnak içine al. Bu dosyaya `READFLOW_SERVER_URL`
veya `READFLOW_WORKER_TOKEN` **ekleme** (kurulum reddeder).

## 4. Agent CLI

AI özetleri için en az bir CLI kurulu ve oturumu açık olmalı:

```bash
claude        # ilk çalıştırmada giriş yap, sonra çık
# veya: codex login / jcode
```

CLI yoksa uygulama çalışır, yalnızca AI işleri beklemede kalır.

İsteğe bağlı — taranmış PDF'ler için yerel OCR:

```bash
brew install tesseract tesseract-lang poppler
```

## 5. Servisi kur

```bash
pnpm app:install     # launchd servisi: Mac açılınca başlar, çökerse yeniden başlar
pnpm app:status      # durum
pnpm app:logs        # canlı log (Ctrl+C ile çık)
```

Kontrol:

```bash
pnpm diagnose     # Node, veritabanı, giriş ayarları, agent, OCR, servis ve sağlık ucu
```

Tarayıcıda `http://127.0.0.1:3000` → giriş yap → bir metin yapıştır → **Özetle**.
Bir süre sonra Özet sekmesi dolmalı. Dolmazsa `pnpm app:logs` ile agent hatasına bak.

Servis kurmadan denemek için: `pnpm app:start` (terminal açık kaldıkça çalışır;
ortam değişkenlerini `.env.local`'e yazman gerekir).

## 6. Telefondan / başka cihazdan erişim (Tailscale)

1. Tailscale uygulamasını aç ve giriş yap (Mac ve telefonda aynı hesap).
2. Terminalde:

   ```bash
   alias tailscale=/Applications/Tailscale.app/Contents/MacOS/Tailscale
   tailscale serve --bg 3000
   tailscale serve status        # https://<mac-adı>.<tailnet>.ts.net adresini gösterir
   ```

3. Telefonda Tailscale açıkken bu adrese gir ve giriş yap.

`tailscale funnel` **kullanma**: uygulamayı tüm internete açar.
Kapatmak için: `tailscale serve reset`.

Bookmarklet'i Tailscale adresinden açtığın Ayarlar sayfasından yeniden kur; eski
adresle oluşturulan bağlantı çalışmaz.

### Telefondan paylaşma

- **iPhone:** Ayarlar → *Tarayıcıdan gönder* → **iPhone paylaşım menüsü (Kestirmeler)**
  adımlarıyla bir Kestirme kur. Safari'de Paylaş → *Readflow'a gönder* bağlantıyı
  (veya seçili metni) doğrudan arşive ekler. Tailscale açık olmalı.
- **Android:** Tailscale adresini Chrome'da açıp *Ana ekrana ekle* ile uygulamayı kur.
  Paylaş menüsünde Readflow çıkar; paylaşılan bağlantı ana sayfadaki forma dolar,
  **Kaydet** ile eklenir.

### Toplu içe aktarma

```bash
pnpm import:files ~/Documents/Notlar           # .md .txt .html .pdf .docx (alt klasörler dahil)
pnpm import:files ~/Downloads/instapaper.csv   # url sütunlu CSV: Instapaper, Pocket, Readwise…
pnpm import:files ~/Downloads/bookmarks.html   # tarayıcı / Pocket yer imi dışa aktarımı
```

Bağlantılar sırayla indirilir (aralarında 1 sn). Arşivde zaten olanlar ve aynı içerikli
belgeler atlanır, komut tekrar çalıştırılabilir. Başarısız olanlar sonda listelenir;
bot koruması olan siteler için bookmarklet'i kullan.

## 7. Güncelleme

```bash
cd ~/Desktop/Projeler/readflow
git pull
pnpm install
pnpm build
pnpm app:install     # servisi yeniden başlatır
```

Şema değişiklikleri ilk açılışta otomatik uygulanır; öncesinde otomatik yedek alınır.

## 8. Yedekleme ve geri yükleme

Yedek almak için Ayarlar → **Yedeği indir** ya da:

```bash
pnpm db:backup       # ~/.readflow/backups/readflow-<tarih>.sqlite
```

Geri yükleme (başka bir bilgisayara taşıma dahil):

```bash
pnpm app:uninstall                              # uygulama ve worker kapalı olmalı
pnpm db:restore ~/Downloads/readflow-….sqlite --check   # yalnızca doğrula
pnpm db:restore ~/Downloads/readflow-….sqlite           # geri yükle
pnpm app:install
```

`db:restore` arşivin bütünlüğünü ve şema sürümünü denetler, mevcut veritabanını
`backups/pre-restore-*.sqlite` olarak yedekler, dosyayı yerine koyar ve tablo sayılarının
eşleştiğini doğrular. Ayarlar ekranı son yedek 7 günden eskiyse uyarır.

Yedekleri Mac dışına da (harici disk, şifreli bulut) kopyala; tek kopya yedek değildir.

## 9. Kaldırma

```bash
pnpm app:uninstall
tailscale serve reset
rm -rf ~/.readflow     # DİKKAT: tüm belgeler ve yedekler silinir
```

## Linux ve Windows

Uygulama çalışır, ancak servis kurulumu yoktur.

- Adım 1–4 aynıdır (Windows'ta PowerShell kullan; `open -e` yerine not defteri). OCR için `apt install tesseract-ocr tesseract-ocr-tur poppler-utils`.
- Ortam değişkenlerini repo kökündeki `.env.local` dosyasına yaz.
- `pnpm build` ardından `pnpm app:start` ile başlat. Açılışta başlatmak için
  Linux'ta `systemd --user` birimi, Windows'ta Görev Zamanlayıcı ile bu komutu çalıştırabilirsin.
- Veri dizini: `~/.readflow` (Windows'ta `%USERPROFILE%\.readflow`).
