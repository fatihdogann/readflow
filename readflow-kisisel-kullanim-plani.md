# Readflow — kişisel kullanım ve okuma deneyimi geliştirme promptu

Readflow’u yalnızca benim kullandığım, Coolify üzerinden telefonumdan da erişebildiğim, AI işlemlerini Mac’imdeki jcode/diğer mevcut CLI profilleriyle yürüten olgun bir okuma uygulamasına dönüştür. Web uygulaması ve kalıcı veri Coolify’da, AI worker MacBook’ta çalışsın. Aşağıdaki işleri belirtilen sırayla uygula. Yalnızca görünüşü değiştirme; veri akışlarını tamamla, hata durumlarını ele al ve kritik davranışları test et.

## 1. Ürün ve tasarım hedefi

- Arayüz sakin bir okuma uygulaması gibi görünmeli: sıcak kırık beyaz zemin, kömür rengi metin, ince ayırıcılar, tutarlı çizgi ikonlar, az gölge ve güçlü tipografik hiyerarşi. Koyu temada aynı okunabilirlik korunmalı.
- Metin ekranın odağı olsun. Okuma sütunu yaklaşık 65–75 karakter genişliğinde, satır aralığı 1.65–1.8, yazı boyutu masaüstünde 18–20 px, mobilde en az 17 px olsun. Dar ekranda yatay taşma olmasın.
- Belge başlığının altında sade bir araç çubuğu olsun: içerik sürümleri, AI’a sor, notlar ve dışa aktarma. İkincil işlemleri taşma menüsüne yerleştir. Her kontrolü ayrı bir kart içine alma.
- Masaüstünde tek yardımcı panel kullan: “AI’a sor” ve “Notlar” aynı panelde sekmelerle açılsın. İki panel birden okuma alanını sıkıştırmasın. Mobilde klavye açıkken de kullanılabilen geniş bir alt panel veya tam ekran sayfa kullan.
- Metni seçince yakınında küçük bir araç çubuğu göster: üç fosforlu kalem rengi, “Not ekle”, “AI’a sor”. Metin seçilmediğinde bu araçlar görünmesin.
- “Snapshot”, “lease”, ham CLI bayrakları gibi uygulama ayrıntılarını okuma arayüzüne taşımadan “aynı içerikle yeniden dene”, “sırada”, “hazırlanıyor”, “iptal edildi” gibi anlaşılır ifadeler kullan.
- AI ayarları tek bir anlaşılır ekran olarak kalsın; Temel/Gelişmiş ayrımı ekleme. Profil ve model seçimini erişilebilir tut.
- Dokunma hedefleri en az 44 px olsun. Görünür klavye odağı, Escape ile kapatma, odak geri dönüşü, erişilebilir panel/sekme davranışı ve azaltılmış hareket tercihi korunsun.

## 2. Mevcut sorunları gider

- Hydration uyarısındaki `body data-gptw` farkını eklentisiz tarayıcı oturumunda araştır. Bu niteliğin uygulama tarafından mı yoksa eklenti tarafından mı eklendiğini ayır. Eklenti kaynaklıysa kullanıcıya doğru açıklamayı ver; uygulama genelinde `suppressHydrationWarning` ekleyerek gerçek hataları gizleme. Uygulama kaynaklı fark varsa SSR ve ilk istemci render’ını eşitle.
- `src/app/favicon.ico` mevcut. Gerçekte servis edilen simgeyi ve önbelleği kontrol et; Readflow’a ait okunabilir bir ikonla favicon, Apple touch icon ve mobil ana ekran simgelerini tutarlı hale getir. İkon eklemekle çevrimdışı kullanım sağlandığını varsayma.
- `src/components/ExportMenu.tsx` içindeki `window.print()` davranışını “Yazdır” olarak ayrı sun. “PDF indir” gerçekten `.pdf` dosyası üretip indirsin.
- PDF üretimini Coolify’daki uygulama tarafında, seçilen içerik sürümünü kullanan kontrollü bir export servisiyle yap. Türkçe karakterler, uzun paragraflar, Markdown tabloları, kod blokları, sayfa kırılmaları ve kaynak bağlantısı düzgün çıksın. Sidebar, düğmeler ve chat paneli PDF’ye girmesin. Üretim hatası ve hazırlanıyor durumu gösterilsin. Kullanıcı içeriğinin keyfî ağ isteği/script çalıştırmasına izin verme; tarayıcı tabanlı üretim seçilirse süreç ve paralellik sınırı koy.
- Düzenlenmiş metin dahil tüm dışa aktarmalar aynı içerik çözümleyicisini kullansın. Özellikle `src/lib/export/telegram.ts` şu anda `editedContent` alanını dikkate almıyor; bunu düzelt. Seçili AI çıktı revizyonu da doğru aktarılmalı. Kaydedilmemiş taslak varsa kaydetme gereksinimini açıkça göster.

## 3. Filtreleri anlık ve pürüzsüz yap

- `HistoryView.tsx` içindeki GET formunu, sunucuda sorgulama yeteneğini koruyarak ayrı bir istemci filtre çubuğuyla geliştir.
- “Filtreleri uygula” zorunluluğunu kaldır. Klasör, etiket, kaynak, notlu, düzenlenmiş ve AI filtresi değişince sonuçları otomatik güncelle. Metin aramasında yaklaşık 300 ms debounce kullan; Enter ile hemen arat.
- Filtreler URL’de saklansın, geri/ileri gezinme ve yenileme doğru durumu getirsin. Filtre değişince sayfalama sıfırlansın. Hızlı ardışık seçimlerde eski yanıt yeni sonucu ezmesin; input odağı kaybolmasın.
- Üstte geniş arama alanı, altında sade filtreler ve kaldırılabilir aktif filtre etiketleri olsun. “Tümünü temizle”, sonuç sayısı, hafif yükleniyor geri bildirimi ve anlaşılır boş durum ekle.
- Mobilde arama görünür kalsın; filtreler aktif filtre sayısını gösteren bir düğmeyle panelde açılsın. Klasör sayaçları yenilemesiz güncellenmeye devam etsin.

## 4. Gerçek iş iptali ekle

- Mevcut “iptal edip yeniden başlat” davranışına ek olarak bağımsız “İptal et” sun. Pending ve processing işler iptal edilebilsin; iptal hata olarak gösterilmesin.
- Artan numaralı migration ile gerekli durum alanlarını ekle. İptal ve tamamlama yarışı transaction/sahiplik denetimiyle çözülmeli; iptal edilen işin geç gelen çıktısı kaydedilmemeli ve lease kurtarması onu yeniden başlatmamalı.
- Worker iptal talebini algılasın; desteklenen adapter iptal mekanizması üzerinden ilgili CLI sürecini ve yalnızca ona ait alt süreçleri sonlandırsın. Başka CLI oturumlarını etkileme. Yalnızca veritabanı durumunu değiştirerek iptal tamamlandı deme.
- Yeni durum API, sayaçlar, MCP, retry, worker ve arayüzde tutarlı ele alınsın. İptal sonrası yeni iş oluşturulabilsin.

## 5. Belgeye bağlı AI sohbeti ekle

- “AI’a sor” belgeye bağlı, merkezi PostgreSQL veritabanında kalıcı bir soru-cevap paneli açsın. Mobilde okuyup soru sorabileyim; işlem Mac’te seçtiğim CLI profiliyle yürüsün.
- Chat mesajları ve konuşmaları ayrı veri modeli olsun. Chat cevaplarını özet/okunabilirlik çıktılarının üzerine yazma. Mevcut kuyruk, snapshot ve sahiplik altyapısını ortak kullan; yeni iş türünü tüm tüketicilerde açıkça destekle.
- Her soru için belge sürümü/revizyonu, seçilen alıntı, sınırlı konuşma geçmişi, soru ve AI profili sabitlensin. Genel notlar ancak açıkça dahil edersem gönderilsin. İş başladıktan sonra profil veya belge değişikliği o sorunun bağlamını değiştirmesin.
- Varsayılan kaynak görüntülenen içerik olsun; “Orijinal”, “Düzenlenmiş” veya mevcut AI çıktısı seçimi ve kullanılan sürüm panelin üstünde görünsün. Sürüm değişimlerinde eski cevapların hangi içerikten üretildiği anlaşılır kalsın.
- “Ana iddiayı açıkla”, “Bu paragraf ne demek?”, “Metindeki karşı görüşler neler?” gibi birkaç başlangıç önerisi göster. Metin seçiminden açılırsa alıntıyı soru kutusunun üzerinde kaldırılabilir bir blok olarak göster.
- AI yalnızca verilen metne dayanmalı; cevap metinde yoksa bunu söylemeli. Mümkün olduğunda cevapta kısa alıntı/paragraf referansı olsun; uydurma kaynak üretmesin. Uzun içerik bağlam sınırına sığmıyorsa kullanılan bölüm kullanıcıya belirtilsin.
- Gönderiliyor, sırada, yanıt hazırlanıyor, hata, iptal ve yeniden dene durumlarını tamamla. CLI doğrulanmış akış desteği sunmuyorsa sahte token streaming yapma. Yenileme veya mobil bağlantı kopması aynı soruyu ikinci kez oluşturmasın.
- Prompt’ları `src/lib/ai/instructions/` altında tut. Doğrudan uzak LLM API’si ekleme; CLI bayraklarını tahmin etme.

## 6. Fosforlu işaretleme ve bağlama bağlı notlar

- Orijinal ve düzenlenmiş metinde seçim yaparak sarı, yeşil veya lavanta tonunda vurgu eklenebilsin. Açık/koyu temada yazı okunabilir kalsın; renklerin erişilebilir adları olsun.
- Her vurguya isteğe bağlı not eklenebilsin. Vurguyu tıklayınca alıntı ve not küçük bir popover’da açılsın. Not listesinden seçilince ilgili alıntıya kaydırılsın ve kısa süreli vurgu verilsin.
- Genel belge notu da kalsın; sürekli büyük textarea göstermek yerine sade not görünümü ve tıklayınca açılan düzenleme alanı kullan. Panelde genel not ve alıntı notlarını ayırt et. Mevcut not verilerini koru.
- Vurgu işaretlerini `original_text` veya `original_html` içine yazarak orijinali değiştirme. Ayrı annotations tablosunda belge, içerik türü, revizyon/hash, seçili metin, öncesi/sonrası bağlamı ve konum bilgisi sakla.
- DOM konumlarına tek başına güvenme; normalize edilmiş metinle eşleştir. Düzenlenmiş metin değiştiğinde kesin eşleşme yoksa notu yanlış yere yapıştırmak yerine “bağlantısı bulunamadı” olarak koru ve yeniden ilişkilendirmeye izin ver. Tekrarlanan alıntıları, çok paragraflı seçimleri ve örtüşen vurguları belirlenmiş davranışla ele al.
- Metin düzenleme, genel not ve alıntı notu kayıtları birbirini ezmesin. Kaydediliyor/kaydedildi/hata durumları açık olsun; başarısız kayıtta taslak korunsun. Mac ve telefondaki eşzamanlı düzenlemelerde sessiz veri kaybını önlemek için revision kontrolü kullan.

## 7. Telegram kurulumunu tamamla

- Bot token ve chat ID yalnızca Coolify’ın uygulama secret/environment ayarlarından okunsun: `READFLOW_TELEGRAM_BOT_TOKEN` ve `READFLOW_TELEGRAM_CHAT_ID`. Token arayüze, loglara, Git’e veya test çıktısına sızmasın.
- Ayarlarda “Telegram: kurulmadı / yapılandırıldı / doğrulandı / hata” durumlarını ayır. Ortam değişkenleri mevcut diye çalışıyor sayma. Kurulum rehberi ve açıkça tetiklenen “Test mesajı gönder” ekle.
- Rehber BotFather token’ı, botla `/start` konuşması başlatmayı, `getUpdates` yanıtındaki `message.chat.id` alanını ve web sürecini yeniden başlatmayı açıklasın. Var olan bot webhook/polling kullanımını bozma; webhook varsa `getUpdates` kullanılamayacağını belirt ve otomatik silme yapma.
- Belgenin seçilen sürümünü gönder. Uzun içerikte Unicode’u ve mümkün olduğunca paragraf sınırlarını koruyan parçalama yap. Telegram yanıtının `ok` alanını kontrol et; yetki/chat ID hatası, hız sınırı ve kısmi gönderimi anlaşılır göster. Kısmi başarısızlıkta tüm mesajları körlemesine yeniden gönderme.

## 8. Coolify yayını ve MacBook AI worker

- İlk dağıtım hedefi: Next.js production uygulaması, PostgreSQL ve veritabanı tabanlı iş kuyruğu Coolify’da çalışsın. Telefon ve masaüstü tarayıcısı yalnızca Coolify’ın HTTPS alan adına bağlansın. MacBook’ta yalnızca yerel AI worker ve jcode/CLI profilleri çalışsın.
- Mobilde kaydedilen belge Coolify’daki merkezi veritabanına yazılsın; Mac worker dışarıya doğru açtığı doğrulanmış bağlantıyla yeni işleri gecikmeden alsın ve AI sonucunu merkezi veritabanına geri yazsın. MacBook’a dışarıdan gelen açık port, doğrudan HTTP erişimi veya ev ağına inbound bağlantı gerektirme.
- Mevcut SQLite bağlantısını çok makine arasında paylaşma. PostgreSQL uyumlu repository/migration katmanı, merkezi iş kuyruğu ve mevcut snapshot/lease/sahiplik garantilerini koruyan bir geçiş planla. Kullanıcının mevcut `~/.readflow` verisini taşımak için önce yedek, sonra doğrulanabilir içe aktarma aracı ekle; SQLite dosyasını Coolify’a bağlama veya ağ diski üzerinden kullanma.
- Worker MacBook’tan Coolify API’sine yalnızca outbound HTTPS ile bağlansın. Worker kaydı için ayrı, sınırlı yetkili ve döndürülebilir bir enrollment secret kullan. Bu secret yalnızca worker’ın iş claim/heartbeat/complete/fail/iptal uçlarına erişebilsin; web oturumu, Telegram token’ı veya genel uygulama secret’larıyla aynı olmasın.
- Uygulamayı yalnızca benim kullanabileceğim şekilde koru: Coolify’ın HTTPS yönlendirmesi üzerinde Basic Auth ilk koruma katmanı olsun; uygulama içinde de tek kullanıcılı oturum, güvenli cookie, CSRF ve mutasyonlarda origin denetimi kullan. Mobil IP adresi değişebileceği için IP allowlist’i tek güvenlik katmanı olarak kullanma. Secret’ları Coolify environment alanında sakla, Git’e koyma.
- Mevcut localhost kısıtını değerlendir: AI profil değiştirme/doğrulama `src/lib/api/local.ts` nedeniyle uzak web isteği engellenir. Bu korumayı tümden kaldırma. Yerel istek kuralını, yetkili tek kullanıcı oturumu ve güvenilir reverse-proxy origin doğrulamasıyla değiştir; istemcinin gönderdiği sahte proxy başlıklarına güvenme. Worker API uçları ile kullanıcı mutasyonlarını ayrı yetki sınırlarında tut.
- Coolify deploy sürecini belgele: üretim build/start komutları, PostgreSQL bağlantı değişkenleri, uygulama secret’ları, health check, güvenli domain/HTTPS, Basic Auth ve rollback. Uygulama güncellemesi worker’ı veya kuyruktaki işleri bozmasın.
- Worker için macOS launchd kurulumu belgele: CLI oturumu, PATH/env yüklemesi, otomatik yeniden başlatma, sınırlı log saklama ve worker health heartbeat. Kurulum komutlarını önce incelemeye hazırla; sistem servisi ayarlarını ancak bu dağıtım adımı yetkilendirildiğinde uygula.
- MacBook açık, uyanık ve internete bağlıysa AI işleri hemen çalışsın. Mac kapalıyken web uygulaması ve belge kaydı çalışmaya devam etsin; AI işleri açıkça “Mac worker bekleniyor” durumunda kuyruğa alınsın. Worker yeniden bağlanınca mevcut işi güvenli biçimde devralsın.
- Telefonda ana ekrana eklenebilir simge/manifest ve güvenli alan uyumunu sağla. Çevrimdışı okuma veya arka plan senkronizasyonunu bu sürümde vaat etme.

## 9. Uygulama sırası ve kabul ölçütleri

- Sıra: Coolify + PostgreSQL + Mac worker mimarisi ve veri taşıma hazırlığı → mevcut hatalar ve export içerik doğruluğu → canlı filtreler → gerçek iptal → chat → vurgu/bağlam notları → dağıtım güvenliği ve son görsel doğrulama.
- Mevcut migration’ları değiştirme; yeni artan id’ler kullan. Orijinal içerik değişmezliği, mevcut notlar, editler ve AI geçmişi korunsun. Kullanıcı verisi Git’e girmesin.
- Kritik testler: PostgreSQL geçişi ve SQLite içe aktarması; seçilen sürümün PDF/Telegram’a gitmesi; iptal–tamamlama yarışı; chat snapshot ve idempotency; Mac worker’ın kesilip yeniden bağlanması; eski/tekrarlanan alıntı eşleştirmesi; not kayıt çakışması; anlık filtre/URL geri-ileri davranışı; tek kullanıcı, worker ve yetkisiz isteklerin erişim sınırları.
- Masaüstü ve mobilde gerçek tarayıcıyla belge okuma, metin seçimi, not, chat, iptal ve PDF indirme akışlarını kontrol et. PDF’nin yalnızca indirilmesini değil açılabilirliğini ve doğru metni içerdiğini doğrula. Telegram testlerinde gerçek token kullanma; gerçek gönderimi yalnızca açık test isteğiyle yap.
- Test, lint, typecheck ve production build geçsin. Teslimde değişen davranışları, gerekli ortam değişkenlerini, çalıştırma adımlarını ve kalan gerçek sınırlamaları kısa biçimde raporla. Tamamlanmamış özellikleri tamamlandı olarak sunma.
