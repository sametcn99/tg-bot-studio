import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import tr from './locales/tr.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import modulesEn from './locales/modules.en.json';
import modulesTr from './locales/modules.tr.json';
import modulesDe from './locales/modules.de.json';
import modulesRu from './locales/modules.ru.json';

/**
 * Every supported dashboard language with its native display name. The list
 * drives the sidebar language cycle button; adding a language means adding
 * its shell + modules JSON pair and one entry here.
 */
export const UI_LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'tr', native: 'Türkçe' },
  { code: 'de', native: 'Deutsch' },
  { code: 'ru', native: 'Русский' },
] as const;

/** Codes of the supported dashboard languages. */
export const UI_LANGUAGE_CODES: string[] = UI_LANGUAGES.map((language) => language.code);

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

/** Shell + module catalogs per language code. */
const CATALOGS: Record<string, { shell: Record<string, unknown>; modules: Record<string, unknown> }> = {
  en: { shell: en as Record<string, unknown>, modules: modulesEn as Record<string, unknown> },
  tr: { shell: tr as Record<string, unknown>, modules: modulesTr as Record<string, unknown> },
  de: { shell: de as Record<string, unknown>, modules: modulesDe as Record<string, unknown> },
  ru: { shell: ru as Record<string, unknown>, modules: modulesRu as Record<string, unknown> },
};

/** First-run language: follow the browser locale (Turkish market first). */
function detectLanguage(): string {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem('studio_language');
  if (saved && UI_LANGUAGE_CODES.includes(saved)) return saved;
  const candidates = navigator.languages ?? [navigator.language ?? 'en'];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const match = UI_LANGUAGE_CODES.find((code) => lower.startsWith(code));
    if (match) return match;
  }
  return 'en';
}

/** Applies html lang/dir attributes so text direction follows the language. */
function applyDocumentLanguage(code: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.dir = code === 'ar' || code === 'fa' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(CATALOGS).map(([code, catalogs]) => [
      code,
      { translation: deepMerge(catalogs.shell, { modules: catalogs.modules }) },
    ]),
  ),
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', applyDocumentLanguage);

export default i18n;
