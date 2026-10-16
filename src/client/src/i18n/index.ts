import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
// English ships with the entry chunk as the fallback language; every other
// catalog is loaded on demand (see `ensureLanguage`) so the initial bundle
// only carries one language pair.
import en from './locales/en.json';
import modulesEn from './locales/modules.en.json';

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

/** Language codes whose shell + modules catalogs are already registered. */
const loadedLanguages = new Set<string>(['en']);

/**
 * Loads the shell + modules catalogs for `code` via dynamic import and
 * registers them as the `translation` bundle. Resolves immediately when the
 * catalogs are already loaded (idempotent).
 * @param {string} code - Language code to load.
 * @returns {Promise<void>} Resolves once resources for `code` are available.
 */
export async function ensureLanguage(code: string): Promise<void> {
  if (loadedLanguages.has(code)) return;
  loadedLanguages.add(code);
  const [shell, modules] = await Promise.all([
    import(`./locales/${code}.json`),
    import(`./locales/modules.${code}.json`),
  ]);
  i18n.addResourceBundle(
    code,
    'translation',
    deepMerge(shell.default as Record<string, unknown>, {
      modules: modules.default as Record<string, unknown>,
    }),
    true,
    true,
  );
}

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

const initialLanguage = detectLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: deepMerge(en as Record<string, unknown>, {
        modules: modulesEn as Record<string, unknown>,
      }),
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // The tree is not wrapped in a Suspense boundary for translations; key
  // flashes are preferable to suspension while lazy catalogs load.
  react: { useSuspense: false },
});

applyDocumentLanguage(initialLanguage);
i18n.on('languageChanged', applyDocumentLanguage);
i18n.on('languageChanged', (code) => {
  // Safety net: any language change (including direct i18n.changeLanguage
  // calls) makes sure its catalogs exist.
  void ensureLanguage(code);
});

// Switch to the detected language once its catalogs arrive — the first paint
// renders in English (the fallback) for non-English operators instead of
// flashing raw keys.
if (initialLanguage !== 'en') {
  void ensureLanguage(initialLanguage).then(() => {
    void i18n.changeLanguage(initialLanguage);
  });
}

export default i18n;
