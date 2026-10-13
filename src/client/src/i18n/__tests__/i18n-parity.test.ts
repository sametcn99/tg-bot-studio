/**
 * i18n integrity suite: en/tr key parity for the shell catalogs, en/tr parity
 * for the registry-content catalogs, and full registry coverage (every
 * module name, description, field label/help, column header, docs array, and
 * placeholder description must exist in BOTH locales).
 * @module i18n/__tests__/i18n-parity
 */
import { describe, expect, it } from 'bun:test';
import en from '../locales/en.json';
import tr from '../locales/tr.json';
import modulesEn from '../locales/modules.en.json';
import modulesTr from '../locales/modules.tr.json';
import { MODULES, MINI_APPS_DOCS_ENTRY, PLACEHOLDERS } from '../../registry/modules';

type Json = Record<string, unknown>;

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

describe('shell locale parity (en.json vs tr.json)', () => {
  it('has identical key trees', () => {
    const enKeys = new Set(flatKeys(en));
    const trKeys = new Set(flatKeys(tr));
    const missingInTr = [...enKeys].filter((key) => !trKeys.has(key));
    const extraInTr = [...trKeys].filter((key) => !enKeys.has(key));
    expect(missingInTr).toEqual([]);
    expect(extraInTr).toEqual([]);
  });
});

describe('registry content parity (modules.en.json vs modules.tr.json)', () => {
  it('has identical key trees', () => {
    const enKeys = new Set(flatKeys(modulesEn));
    const trKeys = new Set(flatKeys(modulesTr));
    const missingInTr = [...enKeys].filter((key) => !trKeys.has(key));
    const extraInTr = [...trKeys].filter((key) => !enKeys.has(key));
    expect(missingInTr).toEqual([]);
    expect(extraInTr).toEqual([]);
  });

  it('does not collide with shell keys in the modules namespace', () => {
    const moduleKeys = Object.keys(modulesEn);
    const collisions = moduleKeys.filter((key) => SHELL_MODULE_KEYS.has(key));
    expect(collisions).toEqual([]);
  });
});

describe('registry content coverage', () => {
  const entries = [...MODULES, MINI_APPS_DOCS_ENTRY];
  // The catalogs are keyed by module key and nest under `modules` at init.
  const enTree = { modules: modulesEn } as Json;
  const trTree = { modules: modulesTr } as Json;

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

  for (const locale of [
    ['en', enTree],
    ['tr', trTree],
  ] as const) {
    it(`covers every registry string in ${locale[0]}`, () => {
      const missing: string[] = [];
      for (const entry of entries) {
        for (const key of requiredKeys(entry)) {
          const value = getPath(locale[1], key);
          if (value === undefined) missing.push(key);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`keeps docs arrays complete in ${locale[0]}`, () => {
      for (const entry of entries) {
        for (const section of ['overview', 'setup', 'troubleshooting'] as const) {
          const localized = getPath(locale[1], `modules.${entry.key}.docs.${section}`);
          expect(Array.isArray(localized)).toBe(true);
          expect((localized as string[]).length).toBe(entry.docs[section].length);
        }
      }
    });
  }
});

describe('placeholder dictionary coverage', () => {
  for (const locale of [
    ['en', en as Json],
    ['tr', tr as Json],
  ] as const) {
    it(`covers every placeholder description in ${locale[0]}`, () => {
      const missing = PLACEHOLDERS.map((placeholder) =>
        placeholder.tag.replace(/[{}]/g, ''),
      ).filter((tag) => getPath(locale[1], `placeholders.${tag}`) === undefined);
      expect(missing).toEqual([]);
    });
  }
});
