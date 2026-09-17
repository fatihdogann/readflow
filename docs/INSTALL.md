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

## 5. Servisi kur

```bash
pnpm app:install     # launchd servisi: Mac açılınca başlar, çökerse yeniden başlar
pnpm app:status      # durum
pnpm app:logs        # canlı log (Ctrl+C ile çık)
```

Kontrol:

```bash
curl -s http://127.0.0.1:3000/api/health     # {"ok":true}
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

```bash
pnpm db:backup       # ~/.readflow/backups/readflow-<tarih>.sqlite
```

Geri yükleme: `pnpm app:uninstall` → yedeği `~/.readflow/readflow.sqlite` olarak kopyala,
yanındaki `-wal` ve `-shm` dosyalarını sil → `pnpm app:install`.

Yedekleri Mac dışına da (harici disk, şifreli bulut) kopyala; tek kopya yedek değildir.

## 9. Kaldırma

```bash
pnpm app:uninstall
tailscale serve reset
rm -rf ~/.readflow     # DİKKAT: tüm belgeler ve yedekler silinir
```

## Linux ve Windows

Uygulama çalışır, ancak servis kurulumu yoktur.

- Adım 1–4 aynıdır (Windows'ta PowerShell kullan; `open -e` yerine not defteri).
- Ortam değişkenlerini repo kökündeki `.env.local` dosyasına yaz.
- `pnpm build` ardından `pnpm app:start` ile başlat. Açılışta başlatmak için
  Linux'ta `systemd --user` birimi, Windows'ta Görev Zamanlayıcı ile bu komutu çalıştırabilirsin.
- Veri dizini: `~/.readflow` (Windows'ta `%USERPROFILE%\.readflow`).
