/**
 * Minimal, zero-dependency localization scaffold for the Mini App shell.
 *
 * Bot owners can override any user-facing string per app by adding an `ui`
 * object to the app's `config` JSON in the studio:
 *
 * ```json
 * {
 *   "products": [{ "id": "a", "title": "A", "price": 1 }],
 *   "ui": { "ecommerce.add": "In den Warenkorb", "ecommerce.checkout": "Kasse" }
 * }
 * ```
 *
 * `createT(config)` receives the app config object (i.e. `TmaAppConfig.config`,
 * the JSON parsed from `configJson`) and reads overrides from `config.ui[key]`.
 * Resolution order for `t(key, fallback, params)`:
 *   1. `config.ui[key]` when it is a non-empty string (owner override),
 *   2. the English default from {@link EN_DEFAULTS},
 *   3. the `fallback` argument passed at the call site,
 *   4. the key itself (last resort).
 * `{placeholder}` tokens in the resolved string are interpolated from `params`.
 * @module i18n
 */

/** Translator function returned by {@link createT}. */
export type TmaTranslate = (
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => string;

/**
 * English default strings (locale `en`). Keys are namespaced by template so
 * bot owners can discover overridable strings easily. Keep values identical
 * to the hardcoded strings they replace.
 */
export const EN_DEFAULTS: Record<string, string> = {
  // Shell (App.tsx)
  'app.slugMissing': 'No Mini App slug found in the URL.',
  'app.loading': 'Loading Mini App...',
  'app.openInTelegram':
    'Open this app inside Telegram to enable personalized features and secure data access.',
  'app.unknownTemplate': 'Unknown template type.',
  'app.retry': 'Retry',
  'app.configLoadFailed': 'Failed to load the app configuration.',

  // Shared
  'common.processing': 'Processing...',
  'common.submitting': 'Submitting...',
  'common.pts': 'pts',

  // Ecommerce template
  'ecommerce.add': 'Add',
  'ecommerce.cart': 'Cart',
  'ecommerce.checkout': 'Checkout',
  'ecommerce.viewCart': 'View cart',
  'ecommerce.noProducts': 'No products configured yet.',
  'ecommerce.cartEmpty': 'Your cart is empty.',
  'ecommerce.allCategory': 'All',
  'ecommerce.paymentsRequireTelegram':
    'Payments require Telegram. Open this app inside Telegram to check out.',
  'ecommerce.paymentNotCompleted': 'Payment not completed ({status}).',
  'ecommerce.paymentReceived': 'Payment received — thank you! 🎉',
  'ecommerce.orderStatus': 'Order status: {status}',
  'ecommerce.checkoutFailed': 'Checkout failed',

  // Forms template
  'forms.fieldRequired': '"{field}" is required.',
  'forms.selectOption': 'Select an option',
  'forms.filePlaceholder': 'Paste a file link (https://...)',
  'forms.noFields': 'No fields configured yet.',
  'forms.submit': 'Submit',
  'forms.submitted': 'Submission received. Thank you.',
  'forms.failed': 'Submission failed',

  // Spin template
  'spin.button': 'Spin the wheel',
  'spin.spinning': 'Spinning...',
  'spin.failed': 'Spin failed',
  'spin.currentBalance': 'Current balance: {points} pts',
  'spin.prizeInventory': 'Prize inventory',
  'spin.noPrizes': 'No prizes configured yet.',

  // Leaderboard template
  'leaderboard.hint': 'Earn points in chats and check-ins to appear on the leaderboard.',
  'leaderboard.topMembers': 'Top members',
  'leaderboard.rankedMembers': '{total} ranked member{plural}',
  'leaderboard.youHave': 'you have {points} pts',
  'leaderboard.empty': 'No ranked members yet — be the first!',
  'leaderboard.yourPosition': 'Your position',

  // Loyalty template
  'loyalty.pointsBalance': 'Points balance',
  'loyalty.dailyCheckIn': 'Daily check-in',
  'loyalty.checkedInToday': 'Checked in today',
  'loyalty.checkInComplete': 'Check-in complete. +{points} points.',
  'loyalty.checkInFailed': 'Check-in failed',
  'loyalty.tierPoints': '{points}+ pts',
  'loyalty.inviteFriends': 'Invite friends',
  'loyalty.inviteHint':
    'Share your referral link and earn bonus points for every friend who joins.',
  'loyalty.share': 'Share referral link',

  // Support template
  'support.greetingFallback':
    'Describe your issue and our team will reply here or in the bot chat.',
  'support.placeholder': 'How can we help?',
  'support.send': 'Send request',
  'support.sending': 'Sending…',
  'support.sent': 'Your request has been sent. We will get back to you soon.',
  'support.failed': 'Submission failed',

  // Webview template
  'webview.noUrl': 'No external URL configured.',
  'webview.openInBrowser': 'Open in browser',
};

/** Token used for `{placeholder}` interpolation. */
const PARAM_PATTERN = /\{(\w+)\}/g;

/**
 * Creates a translator bound to one app's `ui` overrides.
 * @param {Record<string, unknown>} [config] - The app's template config object
 *   (`TmaAppConfig.config`); overrides are read from its optional `ui` object.
 * @returns {TmaTranslate} Translator resolving owner overrides first, then
 *   English defaults, then the call-site fallback.
 */
export function createT(config?: Record<string, unknown>): TmaTranslate {
  const overrides =
    config && typeof config.ui === 'object' && config.ui !== null
      ? (config.ui as Record<string, unknown>)
      : {};

  return (key, fallback, params) => {
    const override = overrides[key];
    const template =
      typeof override === 'string' && override.length > 0
        ? override
        : (EN_DEFAULTS[key] ?? fallback ?? key);
    if (!params) return template;
    return template.replace(PARAM_PATTERN, (token, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
    );
  };
}
