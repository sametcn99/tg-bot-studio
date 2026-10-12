import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

/**
 * Initializes i18next with English as the default and only shipping locale,
 * per the platform language policy.
 * @returns {Promise<typeof i18n>} Initialized i18next instance.
 */
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
