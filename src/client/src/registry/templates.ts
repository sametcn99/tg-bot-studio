/**
 * Content template library: curated, bilingual starting points for the
 * drip-sequence steps, autoresponder replies, and inline-button layouts.
 * Every user-facing string is stored as a `LocalText` pair and resolved with
 * `pickText` at pick time, so operators seed forms with proven content in
 * their active language instead of a blank page.
 * @module registry/templates
 */

/** A user-facing string stored in both supported studio languages. */
export interface LocalText {
  en: string;
  tr: string;
}

/** Languages supported by template content. */
export type ContentTemplateLang = 'en' | 'tr';

/** Field kinds a template can seed; mirrors the AI generation kinds. */
export type ContentTemplateKind = 'drip-steps' | 'autoresponder' | 'buttons';

/**
 * A ready-made content seed offered by the template picker.
 * @interface ContentTemplate
 * @property {string} id - Stable unique identifier.
 * @property {ContentTemplateKind} kind - Form field kind this template seeds.
 * @property {string[]} moduleKeys - Module registry keys this template fits.
 * @property {LocalText} name - Display name in both languages.
 * @property {LocalText} description - Short business description in both languages.
 * @property {unknown} payload - Field payload; `LocalText` leaves are resolved
 *   to plain strings for the active language when the template is picked
 *   (drip steps become `{delayMinutes, text}` arrays, autoresponder payloads
 *   become the plain response string, button layouts stay as keyboard JSON).
 */
export interface ContentTemplate {
  id: string;
  kind: ContentTemplateKind;
  moduleKeys: string[];
  name: LocalText;
  description: LocalText;
  payload: unknown;
}

/**
 * Authoring shape of one drip-steps template step; `text` resolves per language.
 * @interface DripStepTemplate
 * @property {number} delayMinutes - Minutes after the previous step.
 * @property {LocalText} text - Message text in both languages.
 */
export interface DripStepTemplate {
  delayMinutes: number;
  text: LocalText;
}

/**
 * Picks the string for the active language, falling back to English.
 * @param {LocalText} text - Bilingual string.
 * @param {ContentTemplateLang} lang - Active language.
 * @returns {string} Text in the requested language.
 */
export function pickText(text: LocalText, lang: ContentTemplateLang): string {
  return text[lang] || text.en;
}

/**
 * The template catalog consumed by the template picker. Filtered by `kind`
 * plus `moduleKeys` membership at render time.
 * @type {ContentTemplate[]}
 */
export const CONTENT_TEMPLATES: ContentTemplate[] = [
  // ---------------------------------------------------------------- drip-steps
  {
    id: 'drip-onboarding-journey',
    kind: 'drip-steps',
    moduleKeys: ['drip'],
    name: { en: 'Onboarding journey', tr: 'Onboarding yolculuğu' },
    description: {
      en: 'Welcome new subscribers, share a practical tip, then present a limited-time offer across three days.',
      tr: 'Yeni aboneleri karşılar, pratik bir ipucu paylaşır ve üç gün içinde süreli bir teklif sunar.',
    },
    payload: [
      {
        delayMinutes: 0,
        text: {
          en: 'Welcome aboard, {first_name}! 🎉 Thank you for joining. Over the next few days I will share a few short tips so you get value from day one.',
          tr: 'Aramıza hoş geldiniz, {first_name}! 🎉 Katıldığınız için teşekkürler. Önümüzdeki birkaç günde ilk günden değer sağlamanız için kısa ipuçları paylaşacağım.',
        },
      },
      {
        delayMinutes: 1440,
        text: {
          en: '💡 Quick tip: send /help anytime to see everything I can do, and save this chat so you never miss an update.',
          tr: '💡 Küçük bir ipucu: Yapabildiklerimi görmek için dilediğiniz an /help yazabilir, hiçbir güncellemeyi kaçırmamak için bu sohbeti kaydedebilirsiniz.',
        },
      },
      {
        delayMinutes: 4320,
        text: {
          en: '🎁 A small welcome gift: enjoy 10% off your first order with code WELCOME10. Valid this week only — send /start to claim it.',
          tr: '🎁 Küçük bir hoş geldin hediyesi: WELCOME10 koduyla ilk siparişinizde %10 indirim. Yalnızca bu hafta geçerli — kullanmak için /start yazın.',
        },
      },
    ],
  },
  {
    id: 'drip-post-purchase-care',
    kind: 'drip-steps',
    moduleKeys: ['drip'],
    name: { en: 'Post-purchase care', tr: 'Satış sonrası takibi' },
    description: {
      en: 'Thank buyers, deliver usage tips, ask for a review, and follow up with a tailored upsell over a week.',
      tr: 'Alıcıya teşekkür eder, kullanım ipuçları verir, değerlendirme ister ve bir hafta içinde uygun bir ek teklifle takip eder.',
    },
    payload: [
      {
        delayMinutes: 0,
        text: {
          en: 'Thank you for your order, {first_name}! 🙏 Your purchase is confirmed and being prepared. I will check in shortly with a few useful tips.',
          tr: 'Siparişiniz için teşekkürler, {first_name}! 🙏 Satın alımınız onaylandı ve hazırlanıyor. Kısa süre içinde faydalı ipuçlarıyla tekrar yazacağım.',
        },
      },
      {
        delayMinutes: 1440,
        text: {
          en: '📦 Quick tips: check your delivery as soon as it arrives and keep the confirmation in this chat. If anything looks off, just reply here — we will make it right.',
          tr: '📦 Birkaç ipucu: Teslimatınız elinize ulaştığında hemen kontrol edin ve onay mesajını bu sohbette saklayın. Bir sorun görürseniz buradan yazmanız yeterli — hemen çözüme kavuştururuz.',
        },
      },
      {
        delayMinutes: 4320,
        text: {
          en: '⭐ How is everything so far? If you are happy with your experience, a short review would mean a lot to our team — it takes less than a minute.',
          tr: '⭐ Şimdiye kadar her şey yolunda mı? Deneyiminizden memnunsanız, kısa bir değerlendirme ekibimiz için çok değerli — bir dakikadan az sürer.',
        },
      },
      {
        delayMinutes: 10080,
        text: {
          en: '✨ Customers who loved this also picked our care kit — as a thank-you, it is 15% off for you this week. Reply OFFER or send /start to see it.',
          tr: '✨ Bu ürünü seven müşterilerimiz bakım setini de tercih ediyor — teşekkür için bu hafta sizde %15 indirimli. Görmek için OFFER yazın ya da /start gönderin.',
        },
      },
    ],
  },
  {
    id: 'drip-re-engagement',
    kind: 'drip-steps',
    moduleKeys: ['drip'],
    name: { en: 'Re-engagement', tr: 'Yeniden etkileşim' },
    description: {
      en: 'Win back quiet subscribers with a friendly check-in followed by a time-boxed incentive.',
      tr: 'Sessizleşen aboneleri samimi bir hatırlatma ve süreli bir teşvikle geri kazanır.',
    },
    payload: [
      {
        delayMinutes: 0,
        text: {
          en: 'We miss you, {first_name}! 👋 It has been a while since your last visit. Here is a quick look at what is new since then.',
          tr: 'Sizi özledik, {first_name}! 👋 Son ziyaretinizden beri epey zaman geçti. Bu sürede nelerin yeni olduğuna hızlıca göz atalım.',
        },
      },
      {
        delayMinutes: 1440,
        text: {
          en: '💌 A gift to welcome you back: code COMEBACK15 gives you 15% off until the end of the week. Send /start and treat yourself.',
          tr: '💌 Geri dönmeniz için bir hediye: COMEBACK15 kodu hafta sonuna kadar %15 indirim. /start yazın ve kendinizi şımartın.',
        },
      },
    ],
  },
  // -------------------------------------------------------------- autoresponder
  {
    id: 'auto-pricing-faq',
    kind: 'autoresponder',
    moduleKeys: ['autoresponder'],
    name: { en: 'Pricing FAQ', tr: 'Fiyat SSS' },
    description: {
      en: 'Answers the classic "how much does it cost?" trigger with a plan list and a path to a tailored quote.',
      tr: '"Ne kadar?" sorusunu plan listesi ve özel teklif yönlendirmesiyle yanıtlar.',
    },
    payload: {
      en: '💲 Our current price list:\n\n• Starter — $9/month\n• Pro — $29/month\n• Business — custom quote\n\nEvery plan includes a 14-day free trial. For a tailored quote, just reply here or write to sales@example.com.',
      tr: '💲 Güncel fiyat listemiz:\n\n• Starter — 9 $/ay\n• Pro — 29 $/ay\n• Business — özel teklif\n\nTüm planlar 14 gün ücretsiz deneme içerir. Size özel bir teklif için buradan yanıtlayabilir veya sales@example.com adresine yazabilirsiniz.',
    },
  },
  {
    id: 'auto-working-hours',
    kind: 'autoresponder',
    moduleKeys: ['autoresponder'],
    name: { en: 'Working hours & contact', tr: 'Çalışma saatleri ve iletişim' },
    description: {
      en: 'Sets expectations with office hours, response windows, and direct contact channels.',
      tr: 'Çalışma saatleri, yanıt süreleri ve doğrudan iletişim kanallarıyla beklenti belirler.',
    },
    payload: {
      en: '🕘 We are online Monday to Friday, 09:00–18:00 (GMT+3).\n\nMessages outside these hours are answered first thing the next business day.\n\n📧 sales@example.com\n📞 +90 555 000 00 00\n🌐 https://example.com/contact',
      tr: '🕘 Pazartesi–Cuma, 09.00–18.00 (GMT+3) saatleri arasında çevrimiçiyiz.\n\nBu saatler dışında gelen mesajlar ilk iş günü yanıtlanır.\n\n📧 sales@example.com\n📞 +90 555 000 00 00\n🌐 https://example.com/contact',
    },
  },
  {
    id: 'auto-support-policy',
    kind: 'autoresponder',
    moduleKeys: ['autoresponder'],
    name: { en: 'Support policy', tr: 'Destek politikası' },
    description: {
      en: 'Explains response times, urgent-issue handling, and refund terms in one calm message.',
      tr: 'Yanıt sürelerini, acil durum yönetimini ve iade koşullarını tek bir sakin mesajda açıklar.',
    },
    payload: {
      en: '🛟 Our support policy at a glance:\n\n• Every message gets a reply within one business day.\n• Urgent issue? Add URGENT to your message and we will prioritize it.\n• Returns and refunds are handled within 14 days of delivery.\n\nFor anything else, just reply here — a human reads every message.',
      tr: '🛟 Destek politikamız özetle:\n\n• Her mesajı bir iş günü içinde yanıtlıyoruz.\n• Acil bir konu mu var? Mesajınıza ACİL ekleyin, öncelikli olarak ele alalım.\n• İade ve geri ödeme talepleri teslimden itibaren 14 gün içinde sonuçlandırılır.\n\nDiğer her şey için buradan yazmanız yeterli — her mesajı bir insan okur.',
    },
  },
  // -------------------------------------------------------------------- buttons
  {
    id: 'buttons-social-links',
    kind: 'buttons',
    moduleKeys: ['autoresponder', 'scheduler'],
    name: { en: 'Social links', tr: 'Sosyal bağlantılar' },
    description: {
      en: 'One button per row pointing to your website, Instagram, and Telegram channel.',
      tr: 'Web sitenize, Instagram ve Telegram kanalınıza giden, her satırda bir düğme.',
    },
    payload: [
      [{ text: '🌐 Website', url: 'https://example.com' }],
      [{ text: '📸 Instagram', url: 'https://instagram.com/example' }],
      [{ text: '📢 Telegram Channel', url: 'https://t.me/examplechannel' }],
    ],
  },
  {
    id: 'buttons-shop-menu',
    kind: 'buttons',
    moduleKeys: ['autoresponder', 'scheduler'],
    name: { en: 'Shop menu', tr: 'Mağaza menüsü' },
    description: {
      en: 'Storefront layout with a full-width catalog row plus orders and support contact side by side.',
      tr: 'Tam genişlikte katalog satırı ve yan yana siparişler ile destek iletişimi içeren mağaza düzeni.',
    },
    payload: [
      [{ text: '🛍️ Catalog', url: 'https://example.com/catalog' }],
      [
        { text: '📦 My orders', url: 'https://example.com/orders' },
        { text: '💬 Support contact', url: 'https://t.me/examplesupport' },
      ],
    ],
  },
  {
    id: 'buttons-community',
    kind: 'buttons',
    moduleKeys: ['autoresponder', 'scheduler'],
    name: { en: 'Community', tr: 'Topluluk' },
    description: {
      en: 'Invites people into your group, channel, and rules page with three clear rows.',
      tr: 'Grubunuza, kanalınıza ve kurallar sayfanıza üç net satırla davet eder.',
    },
    payload: [
      [{ text: '👥 Join the group', url: 'https://t.me/examplegroup' }],
      [{ text: '📢 News channel', url: 'https://t.me/examplechannel' }],
      [{ text: '📜 Community rules', url: 'https://example.com/rules' }],
    ],
  },
];
