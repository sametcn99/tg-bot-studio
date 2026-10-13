/**
 * Extracts every user-visible string from the client module registry into
 * `src/client/src/i18n/locales/modules.en.json` and verifies Turkish parity
 * against `modules.tr.json` when that file exists.
 *
 * Usage: bun scripts/i18n-extract.ts
 * @module scripts/i18n-extract
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODULES,
  MINI_APPS_DOCS_ENTRY,
  type ModuleEntry,
} from '../src/client/src/registry/modules';

type Json = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Flattens a nested object into dotted key paths (arrays count as leaves).
 * @param {Json} obj - Object to flatten.
 * @param {string} [prefix] - Key prefix from recursion.
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
 * Builds the i18n subtree for one catalog entry.
 * @param {ModuleEntry} entry - Catalog entry.
 * @returns {Json} i18n subtree.
 */
function entryToI18n(entry: ModuleEntry): Json {
  const out: Json = {
    name: entry.name,
    description: entry.description,
    docs: {
      overview: entry.docs.overview,
      setup: entry.docs.setup,
      troubleshooting: entry.docs.troubleshooting,
    },
  };
  const fields: Json = {};
  for (const field of [...(entry.configFields ?? []), ...(entry.crud?.formFields ?? [])]) {
    fields[field.key] =
      field.help === undefined ? { label: field.label } : { label: field.label, help: field.help };
  }
  if (Object.keys(fields).length > 0) out.fields = fields;
  if (entry.crud) {
    const columns: Json = {};
    for (const column of entry.crud.columns) columns[column.key] = column.label;
    out.columns = columns;
  }
  return out;
}

const catalog: Json = {};
for (const entry of MODULES) catalog[entry.key] = entryToI18n(entry);
catalog[MINI_APPS_DOCS_ENTRY.key] = entryToI18n(MINI_APPS_DOCS_ENTRY);

const enPath = resolve(here, '../src/client/src/i18n/locales/modules.en.json');
writeFileSync(enPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${Object.keys(catalog).length} module entries -> ${enPath}`);

const trPath = resolve(here, '../src/client/src/i18n/locales/modules.tr.json');
if (existsSync(trPath)) {
  const tr = JSON.parse(readFileSync(trPath, 'utf8')) as Json;
  const enKeys = new Set(flatKeys(catalog));
  const trKeys = new Set(flatKeys(tr));
  const missingInTr = [...enKeys].filter((key) => !trKeys.has(key));
  const extraInTr = [...trKeys].filter((key) => !enKeys.has(key));
  if (missingInTr.length > 0 || extraInTr.length > 0) {
    if (missingInTr.length > 0) {
      console.error(`Missing in modules.tr.json (${missingInTr.length}):`);
      for (const key of missingInTr) console.error(`  - ${key}`);
    }
    if (extraInTr.length > 0) {
      console.error(`Extra in modules.tr.json (${extraInTr.length}):`);
      for (const key of extraInTr) console.error(`  - ${key}`);
    }
    process.exit(1);
  }
  console.log('Turkish parity OK');
} else {
  console.warn('modules.tr.json not found yet — run again after writing translations.');
}
