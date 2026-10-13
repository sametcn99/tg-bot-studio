# TG Bot Studio — Ürün İyileştirme Raporu

**Tarih:** 2026-10-13 · **Kapsam:** Tüm kod tabanı (sunucu ~63 dosya, dashboard ~47 dosya, Mini App kabuğu, Docker/kurulum) · **Amaç:** Ürünü daha **akıllı** ve **kullanımı kolay** hale getirmek için kanıta dayalı, önceliklendirilmiş bir yol haritası.

---

## 1. Yönetici Özeti

Platform özellik olarak olgun: 21 modül, görsel builder'lar, bağlantı adres defteri, tanılama, simülatör ve preset'ler mevcut. Ancak derinlemesine inceleme üç ana thème bulgu ortaya koyuyor:

1. **Vaat edilen bazı "akıllı" özellikler kozmetik.** AI human handoff gerçekte hiçbir yere yönlendirmiyor (sadece kalıp bir cevap dönüyor), RAG yalnızca anahtar kelime eşleştirme yapıyor, spin çarkında en değerli ödül en çok çıkacak şekilde ağırlıklandırılmış ve TMA sipariş toplamı istemcinin gönderdiği fiyatlardan hesaplanıyor.
2. **Kullanım kolaylığı ciddi boşluklar içeriyor.** Türkçe arayüz sadece "kabuk" düzeyinde (modül içerikleri İngilizce kalıyor), bildirim/toast sistemi hiç yok, bot silme arayüzü yok, tablolarda arama/sıralama/sayfalama yok ve ilk kurulum sihirbazı bulunmuyor. Bot klonlama/konfigürasyon dışa aktarma diye bir kavram yok — çok botlu kullanıcılar için en büyük boşluk bu.
3. **Operasyonel kırılganlık sessiz ilerliyor.** Çöken bot kendini yeniden başlatmıyor, yayın (broadcast) yarıda kesilirse sonsuza dek "running" durumunda kalıyor, yedekleme mekanizması yok, migrasyon şeması sürüm tabelası içermiyor (gelecek bir sürüm mevcut kurulumları sessizce bozar) ve test+CI tamamen sıfır.

Aşağıdaki bölümlerde her bulgu kod kanıtıyla birlikte listelenmiş, sonunda etki/efor dengesine göre önceliklendirilmiş bir yol haritası verilmiştir.

---

## 2. Korunacak Güçlü Yönler

Denge açısından, öncelikle gerçekten iyi çalışan şeyler:

- **Bağlantı adres defteri (Connections)** — paylaşılan sohbet listesi + 30 sn otomatik keşif/senkron, tüm hedef-sohbet alanlarını dropdown'a çeviriyor (`src/server/modules/connections`).
- **Bot tanılama denetçisi** — token geçerliliği, poller durumu, Group Privacy ve bağlantı kontrolü + eyleme dönük öneriler (`bots.service.ts:245-352`).
- **Görsel builder'lar** — buton, drip adımları ve Mini App konfigürasyonu için ham JSON gerektirmeyen editörler (`src/client/src/components/Visual*.tsx`).
- **Stüdyo içi simülatör** — telefon gerekmeden komut/buton/AI testi (`BotSimulatorDrawer.tsx`).
- **1 tık preset'ler** — E-Ticaret / Topluluk / Destek / Büyüme paketleri.
- **Güvenlik temeli** — Argon2id master key, iptal edilebilir JWT oturumları, TMA initData HMAC doğrulaması, imzalı giden webhook'lar, doğrulanabilir (seeded) çekiliş kurası.
- **Her modülde 4 sekmeli yardım diyalogu** — kurulum, placeholder sözlüğü, sorun giderme.

Bu rapor bunları bozmayı değil, üzerine inşa etmeyi hedefliyor.

---

## 3. Bulgular ve Öneriler

### 3.1 Önce Düzeltilmesi Gerekenler (P0 — günler içinde)

Bunlar ya kullanıcıya görünür hatalar ya da kötüye kullanılabilirlik açıkları:

| # | Bulgu | Kanıt | Düzeltme |
|---|-------|-------|----------|
| 1 | **İngilizce arayüzde ham i18n anahtarları görünüyor.** `nav.diagnostics`, `actions.applyPreset` vb. 7 anahtar `tr.json`'da var ama `en.json`'da yok; EN arayüzde butonlar literally "nav.diagnostics" yazıyor. | `BotDashboardPage.tsx:82,91`; `en.json` (152 anahtar) vs `tr.json` (159) | Eksik 7 anahtarı `en.json`'a ekle; i18n parite testi/script'i ekle |
| 2 | **"x / 20 modül" sayısı yanlış** — kayıt defterinde 21 modül var. Ayrıca E-Ticaret preset'i `mini-apps` adında kayıt defterinde olmayan hayalet bir modül anahtarı açıyor (hiçbir handler tüketmiyor, modül listesinde görünmüyor). | `BotDashboardPage.tsx:128`; `bots.service.ts:365-370` vs `module-registry.ts` | Sayıyı kayıt defterinden türet; preset anahtarlarını `MODULE_REGISTRY` doğrulamasından geçir |
| 3 | **Spin çarkı ekonomisi sömürüye açık ve mantıksal olarak hatalı:** (a) istemci ödül tablosunu POST ediyor, sunucu aynen kabul ediyor — değiştirilmiş istemci tek ödüllü çark gönderebilir; (b) ağırlık = puan değeri olduğundan **en değerli ödül en sık çıkıyor**. | `tma.controller.ts:102-111`; `mini-apps.service.ts:275-339` | Ödül tablosunu yalnızca sunucudan oku, istemciden geleni yok say; ağırlığı ayrı bir `weight` alanına taşı |
| 4 | **TMA sipariş toplamı istemci fiyatlarından hesaplanıyor** ve ödeme akışı yok (sipariş hep `pending`). | `tma.controller.ts:82-111`; `mini-apps.service.ts:315-339` | Toplamı sunucu tarafındaki katalog fiyatından hesapla; Telegram Stars invoice akışına bağla ya da "sadece form" olduğunu açıkça belirt |
| 5 | **Broadcast yarıda kesilirse sonsuza dek `running` kalıyor** — devam etme, iptal etme veya zaman aşımı süpürmesi yok. Alıcı başına hatalar sebepsizce yutılıyor (sadece sayaç). | `broadcast.service.ts:96,151-226,213-215` | Başlangıçta `running` kalmış kayıtları `interrupted` işaretle; iptal endpoint'i ekle; hata nedenini kaydet |
| 6 | **Çöken bot kendini toparlamıyor** — poller hatası `failed` durumunu yazıp log'luyor; yeniden deneme/backoff/denetleyici döngüsü yok, operatür müdahalesi bekliyor. | `bot-pool.service.ts:113-134` | Üstel backoff'lu otomatik yeniden başlatma + "N kez denendi" durumu + yöneticiye bildirim |
| 7 | **Ölü konfigürasyon alanları** (kaydediliyor ama hiç okunmuyor): `pauseBetweenBatchesMs`, `timezoneOffsetMinutes` (zamanlama tamamen UTC!), `announceWinners`. | `broadcast.service.ts:166-167`; `scheduler.service.ts`; `giveaways.service.ts` | Ya uygula (zaman dilimi desteği özellikle önemli) ya da arayüzden kaldır — kullanıcıyı yanıltma |
| 8 | **Üretim kodunda dev hack'i:** Mini Apps sayfası `window.location.origin.includes('5173')` kontrolüyle API adresini seçiyor. | `MiniAppsPage.tsx:86-88` | Vite proxy / `VITE_API_URL` env'i ile çöz |

### 3.2 Ürünü Daha Akıllı Yapacak İyileştirmeler

#### 3.2.1 AI Asistan — en büyük "akıllılık" borcu

Mevcut durum (`src/server/modules/ai-assistant/`):

- **RAG anahtar kelime düzeyinde:** sorgu kelimelere bölünüp `includes()` ile eşleştiriliyor; embedding/semantik arama yok, parçalama (chunking) yok. Eşleşme yoksa **ilk 2 doküman yine de enjekte ediliyor** — yanıltıcı bağlam. `tags` alanı depolanıyor ama aramada hiç kullanılmıyor. (`ai-assistant.service.ts:98-117`)
- **Sağlayıcı sadece 2 tane:** OpenAI ve Gemini; Anthropic / yerel (Ollama) / OpenAI-uyumlu baseURL yok. `fetch`'te timeout yok — sağlayıcı takılırsa bot askıda kalır. Gemini anahtarı **URL query parametresi olarak gönderiliyor** (log'lara sızma riski). (`ai-assistant.service.ts:250-279`)
- **Ses transkripsiyonu yalnızca Whisper** (`whisper-1` hardcoded) — Gemini ayarlı botta ses notu sessizce boş dönüş yapıyor. (`ai-assistant.service.ts:161-186`)
- **Human handoff kozmetik:** sabit tetikleyici kelime listesi ("yetkili", "insan", "human"...) eşleşince kalıp iki dilli bir mesaj dönüyor — **hiçbir ticket açılmıyor, destek masasına düşmüyor, yöneticiye bildirim gitmiyor.** Destek modülü kapalıysa "bir insanla görüşmek istiyorum" talebine AI cevap veriyor. (`ai-assistant.runtime.ts:101-121`)
- **Bellek:** tam transkript `ai_chat_history`'de büyüyor (sınırsız), son N tur yeniden oynatılıyor; özetleme veya kullanıcı için sıfırlama komutu yok.

**Öneriler (etki sırasıyla):**

1. **Handoff'u gerçek yap:** tetiklenince (a) destek modülü açıksa o kullanıcı için gerçek bir destek konusu/thread'i aç, (b) değilse yönetici sohbetine (botun kendi kanalıyla) anlık bildirim gönder, (c) dashboard'da "AI → insana devredilenler" görünümü ekle. Bu, README'de vaat edilen bir özelliğin gerçekleşmesi.
2. **RAG'ı semantik hale getir:** dokümanları parçalara böl, embedding tabanlı arama ekle (anahtar kelimeyi fallback olarak tut); eşleşme yoksa hiçbir doküman enjekte etme; `tags`'i filtre olarak kullan. Bilgi tabanı yöneticisine doküman görüntüleyici/düzenleyici ekle (şu an 200 karakter kesme var, düzenleme yok).
3. **Sağlayıcı katmanını genişlet:** OpenAI-uyumlu `baseUrl` alanı tek başına Anthropic/Ollama/DeepSeek vb.'yi açar; tüm sağlayıcı çağrılarına timeout + retry; Gemini anahtarını başlığa taşı.
4. **Ses:** sağlayıcıdan bağımsız STT (OpenAI uyumluysa Whisper, değilse Gemini çok modlu girdi); hata durumunda kullanıcıya "ses işlenemedi" mesajı döndür.
5. **Bağlam zekâsı:** puan/sipariş enjeksiyonu şu an hardcoded TR/EN kelime listelerine bağlı (`service.ts:122-152`) — bunu LLM'e tool/function-calling şemasıyla ver; hem dil bağımsız hem genişletilebilir olur.

#### 3.2.2 Bot klonlama ve konfigürasyon taşıma — en büyük "kolaylık + akıllılık" boşluğu

Şu an **yok**: bir botın modül kurulumunu (otomatik cevaplar, drip akışları, mini app'ler, karşılama metni) başka bota kopyalayamazsın; preset'ler yalnızca fabrika ayarlı modül anahtarlarını açıyor (`bots.service.ts:360-394`'te `applyPreset`'ten başka bir şey yok). Dışa/içe aktarma da yok.

**Öneri:** "Bu botı klonla" (token hariç her şey: modüller + konfigürasyon + drip + otomatik cevaplar + mini app tanımları) ve "kurulumu JSON olarak dışa/içe aktar". Çok botlu ajans/kullanıcı segmenti için tek başına satış noktası olacak özellik; altyapı (tablo yapısı) zaten `bot_id` anahtarlı olduğundan düşük riskli.

#### 3.2.3 Simülatör canlı davranıştan ayrışıyor

`simulateMessage` eşleştirme mantığını gerçek runtime'lardan **ayrı** yeniden implemente ediyor (`bots.service.ts:402-505`); drip, destek, business, referans payload'larını yok sayıyor — sandbox'ta çalışan şey canlıda çalışmayabilir (veya tersi).

**Öneri:** simülasyonu gerçek handler zinciri üzerinden çalıştır (sahte bot örneği + yakalanan `sendMessage` çağrıları). Kod tekrarı da biter, "test ettim ama canlıda farklı davrandı" şikâyeti de.

#### 3.2.4 Zaman dilimi desteği

`scheduler.timezoneOffsetMinutes` kaydedilip okunmuyor; tüm zamanlar UTC. Kullanıcı "her sabah 09:00" isterken UTC hesabı yapmak zorunda.

**Öneri:** bot bazında zaman dilimi ayarı (IANA isimleri), tüm zamanlama yüzeylerinde (scheduler, drip, message-score programları) uygula; arayüzde yerel saat göster.

#### 3.2.5 Öz-iyileşme ve öneriler

- Bot auto-restart (3.1/6) yanına **neden bilgisi ekle**: 401 → "token geçersiz", 409 → "token başka yerde kullanılıyor" diye ayır (şu an ikisi de sadece `failed` noktası).
- Tanılama denetçisi zaten öneri üretiyor; bir adım ileri götür: **"Bu botta X modülü kapalı ama Y kullanım verisi var — açmayı öner"** tarzı kullanım temelli öneriler (ör. destek mesajı trafiği varsa AI copilot önerisi).

### 3.3 Kullanımı Kolaylaştıracak İyileştirmeler

#### 3.3.1 Türkçe deneyim yarım — hedef kitle için en görünür sorun

Arayüz kabuğu (menü, aksiyonlar, giriş) iki dilli; ama **818 satırlık modül kayıt defteri** (modül adları, açıklamalar, tüm alan etiketleri/yardım metinleri, dokümantasyon içeriği) ve sayfaların çoğu İngilizce sabit (`registry/modules.ts`; `SecurityPage`, `ConnectionsPage`, `MessageScorePage`, `MiniAppsPage`, `SupportPage`, `BotSimulatorDrawer`, `AiKnowledgeDocsManager`...). Türk kullanıcı, Türkçe menülerin altında İngilizce içerik görüyor. Ayrıca ölü anahtarlar (`nav.categories.*` çevrilmiş ama kenar çubuğu ham İngilizce kategori adı basıyor) terk edilmiş bir çeviri işine işaret ediyor.

**Öneri:** i18n'yi içerik katmanına tamamla: kayıt defterindeki metinleri anahtarlara taşı, kategori adlarını `nav.categories.*`'a bağla, sayfa bazlı hardcoded string'leri süpür. Bu ürünün (TR pazarına oynayan) kullanıcıları için muhtemelen tek başına en yüksek algılanan iyileştirme.

#### 3.3.2 Bildirim (toast) sistemi yok

Hiçbir sayfada Snackbar/toast kullanılmıyor; geri bildirim sayfa başına değişken (kalıcı Alert, sadece-hata, hiç biri) ve bazı aksiyonlar **hiçbir geri bildirim vermiyor** (Mini Apps blur'da kaydet, webhook oluşturma). Dört farklı geri bildirim kalıbı aynı tür aksiyon için kullanılıyor.

**Öneri:** merkezi Snackbar/notistack katmanı; standart "kaydedildi / silindi / hata" kısa süreli bildirimleri; kalıcı Alert'leri yalnızca form doğrulama hatalarına bırak.

#### 3.3.3 Ortak veri tablosu: arama / sıralama / sayfalama

Sadece CRM sayfasında arama+sayfalama var (o da istemci tarafında ve debounce'suz — her tuş vuruşu tam istek atıyor). CrudPage tabloları, güvenlik logları, webhook logu, VIP tablosu, sıralı listeler: arama yok, sıralama yok, sınırsız satır. Mini Apps sipariş/form verisi **sessizce ilk 25 satırda kesiliyor**. Sunucu tarafında hiçbir liste endpoint'i sayfalama desteklemiyor (CRM `LIMIT 2000` sonrası JS'te filtreliyor).

**Öneri:** (a) istemcide paylaşılan `DataTable` bileşeni (arama + sütun sıralama + sayfalama), (b) sunucuda listelere offset/cursor sayfalama, (c) kesilen veriler için "tümünü gör" / sayfalayıcı.

#### 3.3.4 Eksik temel UX parçaları

- **Bot silme arayüzü yok** — `DELETE /api/bots/:id` backend'de duruyor (18 tabloyu sert şekilde temizliyor) ama hiçbir bileşen çağırmıyor; bot yalnızca pasifleştirilebiliyor. Silme diyaloğuna "önce verileri dışa aktar" seçeneği de ekle (CRM/form/sipariş verisi kalıcı siliniyor).
- **Dört yıkıcı silme onaysız:** webhook endpoint/gelen kancalar, quizler, message-score programları, bilgi dokümanları — ConfirmDialog kullanan CrudPage/Connections ile tutarsız ve riskli.
- **Kaydedilmemiş değişiklik koruması yok** — `common.unsaved` anahtarı tanımlı ama hiç kullanılmıyor; form ortasında gezinme sessizce kaybettiriyor.
- **Tarih-saat girişi iki farklı ve tutarsız kalıp:** CrudPage serbest metin ISO alanı + hızlı çipler; MessageScore `datetime-local`. Tarih seçici kütüphanesi hiç yok.
- **Abone seçici yok:** VIP abeliğe "Telegram id" elle yazılıyor; CRM'deki kullanıcı verisi (arama/puan/etiket) picker kaynağı olarak kullanılmıyor.
- **Webhook olayları virgüllü düz metin** — çoklu seçim çiplerine çevir.
- **Canlı veri:** destek gelen kutusu 4 sn ve yayın geçmişi 5 sn'de bir, sekme görünür olmasa da sonsuza dek poll'üyor. `document.visibilityState` ile durdur; orta vadede SSE'ye geç (altyapı zaten tek port).
- **CrudPage `submit()` korumasız `JSON.parse`** — görsel builder'a düşmeyen gelecekteki bir `json` alanı hata sınırına düşürür (`CrudPage.tsx:160-163`).

#### 3.3.5 İlk kurulum deneyimi

Şu an hiçbir yerde sihirbaz/tur yok; en yakını boş durum CTA'ları ve Add Bot diyalogundaki preset seçimi. Güvenlik tarafında da sessiz tuzaklar var: giriş ekranı varsayılan anahtarı söylüyor ("default: admin123"), docker-compose ayarlanmamış sırlar için sessizce güvensiz varsayılanlara düşüyor, `publicBaseUrl` HTTPS doğrulaması yok (Telegram Mini App ve tıklama takibi HTTPS ister).

**Öneri:**
1. **İlk çalıştırma sihirbazı:** master key değiştir → bot ekle (token doğrula) → preset seç → tanılama çalıştır → "ilk mesajını gönder" kontrol listesi. (Add Bot zaten token doğrulamayı yapıyor — zinciri kurmak kaldı.)
2. **Güvenlik durum bandı:** çalışma zamanında varsayılan anahtar / varsayılan `JWT_SECRET` / HTTPS'siz `publicBaseUrl` tespit edilirse dashboard'da kalıcı uyarı.
3. docker-compose'da sırlar unset ise hızlı başarısız ol (`${VAR:?error}` sözdizimi).

### 3.4 Güven ve Güvenlik

"Kolaylık" algısının altında güven yatar; mevcut açıklar:

| Bulgu | Kanıt | Öneri |
|-------|-------|-------|
| Girişte hız sınırı/kilit yok — master key ağ hızıyla denenebilir | `src/server/auth` (throttle yok) | `@nestjs/throttler` ile login'e IP başı limit + artan gecikme |
| CORS tamamen açık; helmet CSP kapalı | `main.ts:20-21` | Aynı-origin üretim varsayılanı; CSP'yi TMA gereksinimlerine göre yapılandır |
| Bot token'ları düz metin saklanıyor **ve `GET /api/bots` istemciye geri dönüyor**; AI `apiKey` modül listesinde gidiyor | `bots.service.ts:57-93` | Yanıtta maskele (`1234…ABCD`); REST'te şifreleme-at-rest (AES, anahtar env) |
| Gelen webhook alıcısı halka açık ve tek gizliliği URL'de; `/api/go/:id` açık yönlendirme | `webhooks.controller.ts:113-124`; `start-menu.controller.ts:87-96` | URL'ye ek HMAC imza parametresi; yönlendirmede şema/kara liste doğrulaması |
| JWT localStorage'da, oturumlar boşta suresi bitmiyor | `api.ts`; `auth.service.ts` | Kısa ömür + refresh; boşta zaman aşımı |
| Denetim kaydı yalnızca auth olaylarını kapsıyor — konfigürasyon değişikliği, broadcast, silme log'lanmıyor | `security_logs` kullanımı | Modül konfig'i/broadcast/silme eylemlerini denetim kaydına yaz (zaman damgalı "ne değişti" görünümü bonus) |

### 3.5 Operasyon ve Veri Yaşam Döngüsü

- **Yedekleme yok.** Ne endpoint ne zamanlama; WAL modunda dosya kopyalamak tutarsız da üretir. → Ayda/haftada otomatik + tek tık `VACUUM INTO` yedeği (`data/backups/`), dashboard'dan indir; retention politikası.
- **Migrasyonlar sürümsüz:** her açılışta `CREATE TABLE IF NOT EXISTS` dizisi koşuyor; ALTER yolu yok — **mevcut tabloya sütun ekleyen ilk sürüm, mevcut kurulumlara sessizce uygulanmaz.** → `schema_version` tablosu + sıralı, tek seferlik migrasyonlar. Bu, bir sonraki özellik sürümünden önce yapılmalı.
- **Test + CI sıfır:** tek test dosyası yok, script'lerde `test`/`lint` yok, `.github/` yok; tek kalite kapısı `typecheck`. → Yüksek değerli saf mantıklardan başla: initData HMAC doğrulaması, CSV kaçışı, placeholder render'ı, spin ağırlığı, slug sanitizasyonu; GitHub Actions'da `typecheck + test + build` işi.
- **Gözlemlenebilirlik:** log'lar yapılandırılmamış (request-id yok); health yalnızca liveness; bot öldüğünde hiçbir kanaldan bildirim çıkmıyor. → (a) **Yönetici uyarı kanalı:** hata durumundaki bot, sahip olunan botlardan biriyle yöneticiye DM atar (ürünün kendi altyapısıyla — sıfır bağımlılık); (b) health'e DB + bot-pool readiness ekle; (c) yapılandırılmış log.
- **Sınırsız büyüyen tablolar:** `ai_chat_history`, `support_messages`, `broadcasts`, `mini_app_orders`, `security_logs` (yalnızca `chat_activity` 40 gün budanıyor). → Saklama politikası ayarı + periyodik temizlik.
- **Webhook yerine yalnız long-polling:** büyük kitleli botlar veya kilitli ağlar için `setWebhook` seçeneği orta vadeli değer taşır (şu an hiç yok).
- **Sürüm disiplini:** statik `1.0.0`, CHANGELOG/tag yok; güncelleme yolu belgelenmemiş. → Sürüm + CHANGELOG + "bu sürümde migrasyon var" notu.

### 3.6 Kod Mimarisi ve Tutarlılık (bakım hızını doğrudan etkiler)

- **Beş bağımsız `setInterval` zamanlayıcısı** (scheduler/drip/giveaways/message-score/VIP, 30-60 sn) kopyala-yapıştır kapanış koduyla, uçuş halindeki durum kalıcılığı ve jitter olmadan. → Paylaşılan zamanlayıcı soyutlaması (kaydet-idempotent-tick).
- **İki tablo sistemi:** kayıt-defteri destekli CrudPage'e karşılık 8+ elle kurulmuş tablo; `ConnectionsPage` işlevsel olarak CrudPage kopyası. → Ortak `DataTable` (3.3.3) her ikisini de çözer.
- **`MessageScorePage.tsx` 934 satır** (4 endişe tek dosyada); `registry/modules.ts` 818 satır İngilizce içerik + yapı karışık. → Böl/farklı dosyalara taşı (i18n çalışmasıyla birleştirilebilir).
- **İç içe başlık tekrarı:** `ModuleConfigPage` kendi `PageHeader`'ını basıyor ve Support/Engagement/Referrals/MessageScore içine gömülü — aynı modül başlığı iki kez, iki ayrı Kaydet düğmesiyle görünüyor. → Gömülü modda başlığı gizle.
- **Bellek-içi durumlar yeniden başlatmada kayboluyor:** captcha bekleyenler, moderation flood/strike sayaçları, quiz aktif poll haritası (sınırsız büyüen Map'ler). → SQLite'a taşı veya süre bazlı temizle.
- **İsim kayması:** klasör `users-crm` ↔ anahtar `crm`; `captcha` runtime'ı `moderation` klasöründe; start-menu verileri hâlâ `links` tablosunda. → Tutarsızlığı gider (migrasyon notuyla).
- **`bot_settings` JSON-blob kötüye kullanımı:** çekiliş katılımcıları, quizler, webhook endpoint'leri, form gönderimleri (1000 kayıt blob) şemasız JSON'da — ilişkisel sorgu/denetim imkânsız. → Yeni özellikler için gerçek tablo; mevcutlar kademeli taşıma.
- **Erişilebilirlik cilası:** masaüstü bot satırları klavyeyle erişilemiyor (mobil kartlar erişiyor); ~10 icon-butonda `aria-label` yok. Küçük ama ucuz düzeltmeler.

---

## 4. Önceliklendirilmiş Yol Haritası

### Faz 1 — Hızlı kazanımlar (toplam ~1 hafta efor)

| Öneri | Etki | Efor |
|---|---|---|
| eksik `en.json` anahtarları + modül sayısı + ölü preset anahtarı (3.1/1-2) | Hata giderme | saatler |
| Spin güven + sipariş toplamı sunucu tarafı (3.1/3-4) | Güven/açık kapatma | 1-2 gün |
| dev hack'i kaldır, onaysız silmelere ConfirmDialog, bot silme arayüzü (3.3.4) | Kolaylık | 1-2 gün |
| Merkezi toast katmanı (3.3.2) | Kolaylık algısı | 1 gün |
| `VACUUM INTO` tek tık yedek (3.5) | Veri güveni | 1 gün |
| Sürüm tabelalı migrasyon altyapısı (3.5) | Gelecek sürüm güvenliği | 1-2 gün |
| Bot auto-restart + hata nedeni (401/409) + broadcast interrupted süpürmesi (3.1/5-6) | Güvenilirlik | 2 gün |
| İlk kurulum kontrol listesi + varsayılan-sırrı uyarı bandı (3.3.5) | Kolaylık | 1-2 gün |

### Faz 2 — Fark yaratıcılar (2-4 hafta)

| Öneri | Etki | Efor |
|---|---|---|
| Gerçek AI handoff (destek konusu + bildirim + dashboard görünümü) | Vaat edilen özellik | 3-5 gün |
| Türkçe içerik tamamlama (kayıt defteri + sayfalar) | Hedef pazarda algılanan en büyük iyileştirme | 1 hafta |
| Bot klonlama + JSON dışa/içe aktarma | Yeni kullanıcı senaryosu açar | 3-5 gün |
| RAG: chunking + embedding + tags filtresi + doküman editörü | "Akıllı" iddiasının özü | 1 hafta |
| Ortak DataTable + sunucu sayfalama | Tüm listenen sayfalar | 1 hafta |
| AI sağlayıcı katmanı (baseURL/timeout/yeni sağlayıcılar) + STT düzeltmesi | Esneklik | 3-4 gün |
| Zaman dilimi desteği | Kullanım kolaylığı | 3 gün |
| Simülatörü gerçek handler zincirine bağlama | Test güvenilirliği | 3 gün |
| Giriş hız sınırı + CORS + token maskeleme | Güvenlik tabanı | 2-3 gün |

### Faz 3 — Ölçek ve sağlamlık (1-2 ay)

- Webhook modu (setWebhook seçeneği), SSE canlı veri, paylaşılan zamanlayıcı soyutlaması, bellek-içi durumların kalıcılaştırılması, `bot_settings` blob'larının gerçek tablolara taşınması, saklama politikaları, mini test paketi + CI, yapılandırılmış log + readiness, Mini App tema (`theme_json` şu an ölü kod — marka rengi/logo bağla), Telegram Stars ödeme akışı, çok kullanıcılı/rollü erişim (tek master key'den öteye ihtiyaç doğarsa).

---

## 5. Başarı Ölçütleri

İyileştirmelerin kabul kriterleri olarak:

- **İlk değer:** yeni bir kullanıcının "kurulum → ilk çalışan bot → ilk otomatikleştirilmiş eylem" süresi (sihirbazla hedef: 10 dakikanın altı).
- **TR arayüzde kalan İngilizce string oranı** sıfıra iner (i18n parite testiyle korunur).
- Bot çökmesinden **kendi kendine toparlanma** oranı ve toparlanamayanlarda yönetici bildirimi süresi.
- Broadcast iptal/devam yeteneği: `running` durumunda takılı kalan sıfır kayıt.
- Spin/sipariş ekonomisi istemci girdisine dayanmayan tek yüzeyden doğrulanır.
- Test paketi: kritik saf mantık (HMAC, CSV, placeholder, ağırlık) %100 kapsam; CI `typecheck+test+build` yeşil.

---

*Kanıt referansları keşif sırasında doğrulanmıştır; dosya:satır konumları 2026-10-13 itibarıyla geçerlidir.*
