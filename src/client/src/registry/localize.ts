import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MODULES, MINI_APPS_DOCS_ENTRY, type ModuleEntry } from './modules';

/**
 * Returns a localized string list for a docs section, falling back to the
 * registry's original English content when the key is absent.
 * @param {TFunction} t - i18next translator.
 * @param {string} key - Full i18n key of the string array.
 * @param {string[]} fallback - Original English array.
 * @returns {string[]} Localized array.
 */
function localizedList(t: TFunction, key: string, fallback: string[]): string[] {
  const value = t(key, { returnObjects: true }) as unknown;
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : fallback;
}

/**
 * Produces a display copy of a module catalog entry with every user-visible
 * string (name, description, field labels/help, column headers, docs)
 * resolved from the `modules.<key>.*` i18n namespace. Structure, keys,
 * endpoint paths, and option values are untouched.
 * @param {ModuleEntry} entry - Raw catalog entry.
 * @param {TFunction} t - i18next translator.
 * @returns {ModuleEntry} Localized copy (new object; original untouched).
 */
export function localizeModuleEntry(entry: ModuleEntry, t: TFunction): ModuleEntry {
  const base = `modules.${entry.key}`;
  const localizeField = <T extends { key: string; label: string; help?: string }>(field: T): T => {
    const fieldBase = `${base}.fields.${field.key}`;
    return {
      ...field,
      label: t(`${fieldBase}.label`, { defaultValue: field.label }),
      help:
        field.help === undefined ? undefined : t(`${fieldBase}.help`, { defaultValue: field.help }),
    };
  };
  return {
    ...entry,
    name: t(`${base}.name`, { defaultValue: entry.name }),
    description: t(`${base}.description`, { defaultValue: entry.description }),
    configFields: entry.configFields?.map(localizeField),
    crud: entry.crud
      ? {
          ...entry.crud,
          columns: entry.crud.columns.map((column) => ({
            ...column,
            label: t(`${base}.columns.${column.key}`, { defaultValue: column.label }),
          })),
          formFields: entry.crud.formFields.map(localizeField),
        }
      : undefined,
    docs: {
      overview: localizedList(t, `${base}.docs.overview`, entry.docs.overview),
      setup: localizedList(t, `${base}.docs.setup`, entry.docs.setup),
      troubleshooting: localizedList(t, `${base}.docs.troubleshooting`, entry.docs.troubleshooting),
    },
  };
}

/**
 * Hook returning the full module catalog with localized display strings.
 * @returns {ModuleEntry[]} Localized catalog in registry order.
 */
export function useLocalizedModules(): ModuleEntry[] {
  const { t } = useTranslation();
  return useMemo(() => MODULES.map((entry) => localizeModuleEntry(entry, t)), [t]);
}

/**
 * Hook returning one localized catalog entry by key.
 * @param {string} key - Module registry key.
 * @returns {ModuleEntry | undefined} Localized entry when present.
 */
export function useLocalizedModule(key: string): ModuleEntry | undefined {
  const { t } = useTranslation();
  return useMemo(() => {
    const entry = MODULES.find((module) => module.key === key);
    return entry ? localizeModuleEntry(entry, t) : undefined;
  }, [key, t]);
}

/**
 * Hook returning the localized docs-only Mini App Studio catalog entry.
 * @returns {ModuleEntry} Localized Mini App Studio entry.
 */
export function useMiniAppsDocsEntry(): ModuleEntry {
  const { t } = useTranslation();
  return useMemo(() => localizeModuleEntry(MINI_APPS_DOCS_ENTRY, t), [t]);
}

/** Registry category names mapped to their `nav.categories.*` i18n keys. */
export const CATEGORY_I18N_KEYS: Record<string, string> = {
  'Directory & Content': 'directory',
  'Communication & CRM': 'communication',
  'Community & Moderation': 'community',
  'Automation & Monetization': 'automation',
};

/**
 * Localized display name for a registry category.
 * @param {TFunction} t - i18next translator.
 * @param {string} category - Raw (English) category name.
 * @returns {string} Translated category label.
 */
export function localizedCategory(t: TFunction, category: string): string {
  const suffix = CATEGORY_I18N_KEYS[category];
  return suffix ? t(`nav.categories.${suffix}`) : category;
}
