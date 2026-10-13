# TG Bot Studio — Ürün Yol Haritası (v2)

> **DURUM (2026-10-13):** Bu plandaki tüm kalemler uygulandı — Aşama 1 (Anlaşılır ve Kolay), Aşama 2 (Akıllı Ürün) ve Aşama 3 (Kapsam Genişletme). Teslimat ayrıntıları CHANGELOG.md'de. Doğrulama: typecheck (3 hedef), 55 birim testi, ESLint 0 hata, prettier temiz ve production build yeşil. Canlı Telegram akışları (gerçek BotFather tokeni ile) elle doğrulanmalı.

**Tarih:** 2026-10-13
**Bağlam:** `IMPROVEMENT_REPORT.md` denetim raporunun devamı ve güncelleştirmesi. Raporun P0 kalemlerinin büyük bölümü aynı gün HEAD commit'te (`10b2164`) kodlandı; bu yol haritası **kod üzerinden doğrulanmış** kalan boşluklara ve dört ürünsel hedefe odaklanır.
**Hedefler:** Ürünü **daha geniş kapsamlı**, **daha akıllı**, **kullanımı daha kolay** ve **daha anlaşılır** hale getirmek.

---

## 1. Durum Tespiti

### 1.1 Rapor sonrası tamamlananlar (tekrar planlanmayacak)

Aşağıdakiler kodda doğrulanmış şekilde **yapılmış** durumda:

- i18n anahtar paritesi (en.json = tr.json = 177 anahtar)
- Spin çarkı ve TMA sipariş ekonomisinin sunucu tarafına alınması (ağırlık alanı, sunucu tarafı katalog fiyatlaması)
- Bot klonlama + JSON export/import (token hariç tam kopya)
- Merkezi Snackbar katmanı (`SnackbarContext`), DataTable bileşeni
- `VACUUM INTO` yedekleme servisi (`backup.controller.ts`)
- 4 birim testi (initData HMAC, CSV, şablon, spin ağırlıkları) + tam CI zinciri (format → lint → typecheck → test → build)
- Prisma 6 + model katmanı (`src/server/models/`)
- Bot otomatik yeniden başlatma: backoff + 401 (`token_revoked`) / 409 (çakışma) sınıflandırması
- Broadcast iptal endpoint'i; login rate-limit + hesap kilitleme (3 hata → 30 sn, 5 hata → 5 dk)
- Bot token maskeleme (`maskToken`, liste ve detay yanıtlarında)
- AI sağlayıcı katmanı: OpenAI-uyumlu `baseUrl` + 20 sn `AbortSignal.timeout`
- AI handoff: destek kaydı oluşturma + admin sohbetine bildirim (rapordaki "kosmetik" durum kısmen aşıldı)
- Scheduler'da `timezoneOffsetMinutes` kullanımı

### 1.2 Doğrulanmış açık boşluklar (dosya referanslı)

| # | Boşluk | Kanıt |
|---|--------|-------|
| G1 | Modül kataloğu içeriği (ad, açıklama, alan etiketleri, yardım dokümanları) İngilizce sabit; dil değişince kabuk çeviriyor, ~%80 ekran içeriği İngilizce kalıyor | `src/client/src/registry/modules.ts` (948 satır) |
| G2 | `nav.categories.*` çevirileri iki dilde de mevcut ama sidebar ham İngilizce kategori adı basıyor | `Layout.tsx:458` |
| G3 | Sayfa stringleri i18n dışında (Webhooks'ta 11, Monetization'ta 1 `t()` çağrısı) | CrudPage, BotDashboardPage, BotSimulatorDrawer, AiKnowledgeDocsManager, Visual*Builder, Broadcast/Support/MessageScore sayfaları |
| G4 | Tarihler ham ISO gösteriliyor (`created_at?.slice(0,19)`), Intl tabanlı biçimlendirme yok | tüm tablo sayfaları |
| G5 | DataTable yalnızca SecurityPage'te kullanılıyor; CrudPage (start-menu, scheduler, giveaways, drip, autoresponder) arama/sıralama/sayfalama olmadan tüm satırları basıyor | `CrudPage.tsx:314-365`, `DataTable.tsx` |
| G6 | Form standartları: submit sırasında busy durumu yok (çift tık riski), DTO doğrulama mesajları ham class-validator İngilizcesi, `saveConfig` sessiz, `common.unsaved` anahtarı tanımlı ama guard yok | `CrudPage.tsx:160-210` |
| G7 | Varsayılan dil tarayıcı yerelinden bağımsız `en`; `prefers-color-scheme` kullanılmıyor | `i18n/index.ts`, `theme.tsx` |
| G8 | API hata yanıtlarında makine-okunur `code` yok → istemci hatayı yalnızca İngilizce metin olarak alıyor | `http-exception.filter.ts` |
| G9 | AI handoff tetiği 9 kelimelik sabit liste; `escalation_<id>` bayrağı Support Desk'te görünmüyor/çözülemiyor | `ai-assistant.runtime.ts:104-156` |
| G10 | RAG keyword `includes()` tabanlı; eşleşme yoksa bile ilk 2 doküman enjekte ediliyor; `tags` kullanılmıyor; cevapta kaynak gösterimi yok | `ai-assistant.service.ts` |
| G11 | AI hiçbir forma içerik üretmiyor (yalnızca soru-cevap + destek taslağı) | — |
| G12 | Simülatör eşleştirmeyi ayrıca yeniden implemente ediyor, 3/20 modülü kapsıyor, callback butonlar etiketi metin olarak geri yolluyor, otomatik kaydırma yok | `bots.service.ts:459-555`, `BotSimulatorDrawer.tsx` |
| G13 | Buton builder yalnızca URL butonları; callback verisi görsel düzenlemede kayboluyor | `VisualButtonBuilder.tsx:62` |
| G14 | VIP ataması elle Telegram ID istiyor; abone seçici yok | MonetizationPage |
| G15 | Order alanları için ↑/↓ veya sürükle-bırak yok (ham sayı alanı) | start-menu, drip |
| G16 | İlk çalıştırma sihirbazı/turu yok; bot ekleme sırasında preset hatası sessizce yutuluyor | `BotsOverviewPage.tsx:224` |
| G17 | Polling döngüleri sekme gizliyken de sürüyor (destek 4 sn, broadcast 5 sn); SSE yok | SupportPage, BroadcastPage |
| G18 | `prisma db push` kullanılıyor; versiyonlu migrations klasörü yok → kolon eklenen ilk sürüm mevcut kurulumlara uygulanmayacak | `prisma/` (yalnızca schema.prisma) |
| G19 | Büyüyen tablolar için retention yok (ai_chat_history, support_messages, security_logs); yalnızız chat_activity budanıyor | — |
| G20 | Siparişler sonsuza dek `pending`; Stars ödeme onay akışı yok; `themeJson` ölü kod | MiniAppOrder, MiniApp.themeJson |
| G21 | CORS tamamen açık; denetim kaydı yalnızca kimlik doğrulama olaylarını kapsıyor | `main.ts` |

### 1.3 Dört hedefin karşılığı

| Hedef | Ana hamleler |
|-------|--------------|
| **Anlaşılır** | Türkçe deneyimi içeriklere indirme (1A), ilk çalıştırma rehberi + hata kodları (1C) |
| **Kolay** | Tablo/form standartları, abone seçici, sıralama, simülatör iyileştirmeleri (1B, 1C, 2C) |
| **Akıllı** | AI temeli (handoff, semantik RAG) + "AI ile oluştur" (2A, 2B) |
| **Kapsamlı** | Stars ödemeleri, Mini App tema, analitik, canlı veri, operasyonel sağlamlık (Faz 3) |

---

## 2. FAZ 1 — Anlaşılır ve Kolay (~2 hafta) — ✅ TAMAMLANDI

### 1A. Türkçe deneyimi içeriklere indirme (en görünür eksik)

1. **Registry i18n'e taşıma** — `registry/modules.ts` içindeki modül adları, açıklamalar, alan etiketleri ve 4-sekme yardım dokümanları `modules.<key>.*` anahtarlarına taşınır; her iki locale kataloğu büyür; CI'ya i18n parite testi eklenir. → G1
2. **Sayfa stringleri** — CrudPage, BotDashboardPage (klon diyaloğu, güvenlik uyarıları), BotSimulatorDrawer, AiKnowledgeDocsManager, Visual*Builder'lar, Broadcast/Support/MessageScore/Connections sayfaları `t()`'ye geçirilir. → G3
3. **Kategori adları** — `nav.categories.*` sidebar'a bağlanır. → G2
4. **Tarih/sayı yerelleştirme** — `Intl.DateTimeFormat` tabanlı ortak util; ham ISO gösterimlerin tamamı değiştirilir. → G4
5. **Varsayılan dil tarayıcıdan** — tarayıcı yereli `tr` ile başlıyorsa arayüz Türkçe açılır. → G7 (kısmen)

### 1B. Tablo ve form standartları (tek değişiklik 5+ modüle yayılır)

6. **CrudPage'e DataTable** — arama/sıralama/sayfalama; start-menu, scheduler, giveaways, drip, autoresponder tek seferde kazanır. → G5
7. **Form standartları paketi** — submit busy/disabled (çift tık koruması), DTO'lara özel doğrulama mesajları, alan bazlı inline validation, `saveConfig` başarı bildirimi, `common.unsaved` guard'ı (beforeunload + sayfa geçişi). → G6
8. **Kalan tablolar** — webhook teslim kaydı, Engagement listeleri, VIP tablosu DataTable'a geçer. → G5
9. **Abone seçici (UserPicker)** — aramalı modal; mevcut `users` API'siyle beslenir; VIP ataması, broadcast hedefleme ve CRM bağlantılarında kullanılır. → G14
10. **Sıralama düğmeleri** — order alanları için ↑/↓ (start-menu öğeleri, drip adımları). → G15

### 1C. İlk çalıştırma ve hata anlaşılırlığı

11. **İlk çalıştırma sihirbazı** — anahtar rotasyonu → bot ekleme (token doğrulama hazır) → hazır ayar → bağlantı senkronu → simülatörde ilk mesaj; ilerleme saklanır; preset hataları görünür yapılır. → G16
12. **API hata kodları** — hata filtresine `code` alanı; istemcide kod→çeviri eşlemesi; en sık fırlatılan ~57 BadRequest/NotFound mesajı kodlanır. → G8
13. **Simülatör iyileştirmeleri** — otomatik kaydırma, arayüz metinlerinin TR/EN olması, modül sayfalarından "bu kuralı test et" kısayolu (simülatörü hazır mesajla açar). → G12 (kısmen)
14. **Dokümantasyon** — README güncelle (Prisma, testler, CI, klonlama, yedekler eksik), CHANGELOG başlat, `.env.example` tazele.

**Faz 1 bitişi ölçütü:** TR arayüzde İngilizce string kalmaması (parite testiyle korunur), tüm liste görünümlerinde arama/sıralama/sayfalama, tüm formlarda busy + başarı/hata bildirimi.

---

## 3. FAZ 2 — Akıllı Ürün (~4-5 hafta) — ✅ TAMAMLANDI

### 2A. AI temelini sağlamlaştırma

1. **Handoff tamamlama** — tetikleyiciyi sabit kelime listesinden küçük/ucuz bir LLM sınılandırma çağrısına + öfke-tekrar tespitine taşı; `escalation_<id>` durumunu Support Desk'te "AI→İnsan" bekleyenler görünümüyle göster ve çözüldü işaretle; destek modülü kapalıyken davranışı tanımla. → G9
2. **Semantik RAG** — doküman chunking + embedding (mevcut sağlayıcı katmanı üzerinden), tag filtresi, eşleşme yoksa hiçbir şey enjekte etmeme politikası, test aracında cevaba kaynak (citation) gösterimi, doküman editöründe tam içerik. → G10
3. **AI görünürlüğü** — istek başına token/maliyet, gecikme, hata oranı metrikleri modül sayfasında; sesli mesaj transkripsiyon durumu operatöre görünür.

### 2B. AI ile kurma (fark yaratıcı hamle)

4. **"✨ AI ile oluştur"** — formlarda hedefli üretim: autoresponder metinleri, drip adım içerikleri, buton klavyeleri (VisualButtonBuilder JSON şemasına üretim), broadcast metni, destek yanıtı tonu. Sağlayıcı katmanı (baseUrl + timeout) yeniden kullanılır; üretim forma doldurulur, kullanıcı düzenler. → G11
5. **Bilgi tabanı taslağı** — bilgi tabanı boşken "bu bot için SSS/knowledge taslağı üret" önerisi. → G11

### 2C. Doğruluk ve ince ayar

6. **Simülatör gerçek handler zinciri** — `simulateMessage` yerine gerçek `ModuleHandlerRegistry` zinciri + sahte bot örneği; captcha/welcome/moderation/drip senaryoları, kullanıcı kimliği/deep-link yükleri, callback tıklamaları. → G12
7. **Buton tipleri** — builder'a Callback/WebApp/Copy desteği (callback verisi kaybını da düzeltir) + Telegram satır/sütun limit doğrulamaları. → G13
8. **Timezone tutarlılığı** — bot başına IANA saat dilimi; message-score gönderim programlarına uygula; arayüzde yerel saat.
9. **Şablon kütüphanesi** — drip dizileri, autoresponder'lar ve buton klavyeleri için hazır şablonlar (preset'lerin içerik katmanı).

**Faz 2 bitişi ölçütü:** AI handoff taleplerinin %100'ü Support Desk'te görünür ve çözülebilir; RAG cevaplarında kaynak gösterimi ve eşleşmesiz soruda enjeksiyon sıfır; en az 4 form tipinde "AI ile oluştur" etkin.

---

## 4. FAZ 3 — Kapsam Genişletme (~1,5-2 ay) — ✅ TAMAMLANDI

1. **Telegram Stars ödeme akışı** — sipariş → Stars faturası → onay → durum akışı; VIP abonelik yerel Stars abonelik davet linkleriyle zaten Stars faturalı. → G20
2. **Mini App theming** — `themeJson`'ı yayına bağla (marka rengi/logo) + PhonePreview'e yansıt. → G20
3. **Analitik genel bakış** — ChatActivity verisi; bot başına mesaj/etkileşim trendleri (7/30 gün grafikleri).
4. **Canlı veri (SSE)** — destek kutusu ve broadcast ilerlemesi için SSE + sekme gizliyken durdurma. → G17
5. **Operasyonel sağlamlık** — versiyonlu `prisma migrate` geçişi, CORS kısıtlama, büyüyen tablolar için retention politikası, bellek-içi durum sınırlaması, denetim kaydının yapılandırma/silme eylemlerini kapsaması. → G18, G19, G21
6. **Talebe bağlı uzun vadeli** — setWebhook modu, çoklu yönetici/rol sistemi (uygulanmadı; talep halinde planlanır).

**Faz 3 bitişi ölçütü:** `pending` kalmayan ödeme akışı, canlı güncellenen destek/broadcast görünümleri, versiyonlu migration altyapısıyla güvenli sürüm yükseltme.

---

## 5. Başarı Metrikleri

- TR arayüzde İngilizce string oranı **sıfır** (CI'da i18n parite + içerik taraması testiyle korunur)
- CrudPage tablolarının tamamı arama/sıralama/sayfalama destekli
- AI handoff taleplerinin %100'ü Support Desk'te görünür ve çözülebilir
- RAG cevaplarında kaynak gösterimi; eşleşme olmadığında uydurma bağlam enjeksiyonu **sıfır**
- API hataları kullanıcı dilinde (hata kodu → çeviri kapsamı)

## 6. Varsayımlar ve Karar Noktaları

1. **Öncelik sırası:** kullanılabilirlik/anlaşılırlık önce (Faz 1), AI farklılaştırması sonra (Faz 2), kapsam en son (Faz 3).
2. **"Kapsamlı"nın tanımı:** mevcut 21 modülü derinleştirmek + seçili yeni yetenekler. Yeni modül eklemek bilinçli olarak bekleme listesinde.
3. **Hedef kitle:** önce Türkiye pazarı → Türkçe tamamlanması en yüksek görünürlüklü yatırım.
4. **Sürüm disiplini:** CHANGELOG başlatıldı; her faz bir sürüm noktası.

## 7. Uygulama Notları

- Kod değişiklikleri kullanıcı talebi olmadan commit edilmez (kalıcı kural; 2026-10-13 "remotea yolla" talebiyle tek seferlik commit+push yapılmıştır).
- Registry i18n içeriklerini yeniden üretmek / TR paritesini doğrulamak için: `bun scripts/i18n-extract.ts`.
- Semantik RAG OpenAI-uyumlu embeddings ucu gerektirir; olmayan botlar otomatik keyword erişimine düşer.
