/**
 * i18n integrity suite: key parity for every dashboard language across the
 * shell and registry-content catalogs, and full registry coverage (every
 * module name, description, field label/help, column header, docs array, and
 * placeholder description must exist in every locale).
 * @module i18n/__tests__/i18n-parity
 */
import { describe, expect, it } from 'bun:test';
import en from '../locales/en.json';
import tr from '../locales/tr.json';
import de from '../locales/de.json';
import ru from '../locales/ru.json';
import modulesEn from '../locales/modules.en.json';
import modulesTr from '../locales/modules.tr.json';
import modulesDe from '../locales/modules.de.json';
import modulesRu from '../locales/modules.ru.json';
import { MODULES, MINI_APPS_DOCS_ENTRY, PLACEHOLDERS } from '../../registry/modules';

type Json = Record<string, unknown>;

/** Every dashboard language: code -> { shell, modules } catalogs. */
const LANGUAGES: Record<string, { shell: Json; modules: Json }> = {
  en: { shell: en as Json, modules: modulesEn as Json },
  tr: { shell: tr as Json, modules: modulesTr as Json },
  de: { shell: de as Json, modules: modulesDe as Json },
  ru: { shell: ru as Json, modules: modulesRu as Json },
};

/** Shell keys living in the shared `modules` namespace (deepMerge partners). */
const SHELL_MODULE_KEYS = new Set([
  'managerTitle',
  'enabled',
  'configSaved',
  'toggleFailed',
  'noOptions',
  'onePerLine',
  'docsLink',
  'configureLink',
  'settings',
  'recordRemoved',
  'invalidJson',
  'includedModules',
]);

/**
 * Collects dotted leaf paths of a nested JSON object (arrays are leaves).
 * @param {Json} obj - Object to flatten.
 * @param {string} [prefix] - Recursion prefix.
 * @returns {string[]} Dotted key paths.
 */
function flatKeys(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? flatKeys(value as Json, path)
      : [path];
  });
}

/**
 * Reads a dotted path from a JSON object.
 * @param {Json} obj - Root object.
 * @param {string} path - Dotted key path.
 * @returns {unknown} Value when present.
 */
function getPath(obj: Json, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Json)[part];
  }
  return current;
}

describe('shell locale parity (all languages vs en.json)', () => {
  for (const [code, catalogs] of Object.entries(LANGUAGES)) {
    if (code === 'en') continue;
    it(`has an identical key tree in ${code}.json`, () => {
      const enKeys = new Set(flatKeys(en));
      const localeKeys = new Set(flatKeys(catalogs.shell));
      const missing = [...enKeys].filter((key) => !localeKeys.has(key));
      const extra = [...localeKeys].filter((key) => !enKeys.has(key));
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    });
  }
});

describe('registry content parity (all languages vs modules.en.json)', () => {
  for (const [code, catalogs] of Object.entries(LANGUAGES)) {
    if (code === 'en') continue;
    it(`has an identical key tree in modules.${code}.json`, () => {
      const enKeys = new Set(flatKeys(modulesEn));
      const localeKeys = new Set(flatKeys(catalogs.modules));
      const missing = [...enKeys].filter((key) => !localeKeys.has(key));
      const extra = [...localeKeys].filter((key) => !enKeys.has(key));
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    });
  }

  it('does not collide with shell keys in the modules namespace', () => {
    const moduleKeys = Object.keys(modulesEn);
    const collisions = moduleKeys.filter((key) => SHELL_MODULE_KEYS.has(key));
    expect(collisions).toEqual([]);
  });
});

describe('registry content coverage', () => {
  const entries = [...MODULES, MINI_APPS_DOCS_ENTRY];

  /**
   * Collects the i18n keys one catalog entry requires.
   * @param {(typeof entries)[number]} entry - Catalog entry.
   * @returns {string[]} Required dotted key paths.
   */
  function requiredKeys(entry: (typeof entries)[number]): string[] {
    const base = `modules.${entry.key}`;
    const keys = [
      `${base}.name`,
      `${base}.description`,
      `${base}.docs.overview`,
      `${base}.docs.setup`,
      `${base}.docs.troubleshooting`,
    ];
    for (const field of [...(entry.configFields ?? []), ...(entry.crud?.formFields ?? [])]) {
      keys.push(`${base}.fields.${field.key}.label`);
      if (field.help !== undefined) keys.push(`${base}.fields.${field.key}.help`);
    }
    for (const column of entry.crud?.columns ?? []) {
      keys.push(`${base}.columns.${column.key}`);
    }
    return keys;
  }

  for (const [code, catalogs] of Object.entries(LANGUAGES)) {
    const tree = { modules: catalogs.modules } as Json;

    it(`covers every registry string in ${code}`, () => {
      const missing: string[] = [];
      for (const entry of entries) {
        for (const key of requiredKeys(entry)) {
          const value = getPath(tree, key);
          if (value === undefined) missing.push(key);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`keeps docs arrays complete in ${code}`, () => {
      for (const entry of entries) {
        for (const section of ['overview', 'setup', 'troubleshooting'] as const) {
          const localized = getPath(tree, `modules.${entry.key}.docs.${section}`);
          expect(Array.isArray(localized)).toBe(true);
          expect((localized as string[]).length).toBe(entry.docs[section].length);
        }
      }
    });
  }
});

describe('placeholder dictionary coverage', () => {
  for (const [code, catalogs] of Object.entries(LANGUAGES)) {
    it(`covers every placeholder description in ${code}`, () => {
      const missing = PLACEHOLDERS.map((placeholder) =>
        placeholder.tag.replace(/[{}]/g, ''),
      ).filter((tag) => getPath(catalogs.shell, `placeholders.${tag}`) === undefined);
      expect(missing).toEqual([]);
    });
  }
});
