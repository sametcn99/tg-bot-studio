import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import tr from './locales/tr.json';
import modulesEn from './locales/modules.en.json';
import modulesTr from './locales/modules.tr.json';

/**
 * Recursively merges `over` onto `base`, returning a new object. Used to
 * combine the shell locale catalogs with the registry-content catalogs
 * (which share the `modules` namespace with a few shell keys).
 * @param {Record<string, unknown>} base - Base object.
 * @param {Record<string, unknown>} over - Object whose leaves win.
 * @returns {Record<string, unknown>} Merged copy.
 */
function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
        ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

/** First-run language: follow the browser locale (Turkish market first). */
function detectLanguage(): string {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem('studio_language');
  if (saved === 'tr' || saved === 'en') return saved;
  const browser = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
  return browser.startsWith('tr') ? 'tr' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: deepMerge(en, { modules: modulesEn }) },
    tr: { translation: deepMerge(tr, { modules: modulesTr }) },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
