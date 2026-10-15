import { describe, expect, test } from 'bun:test';
import en from '../i18n/locales/bot-messages.en.json';
import tr from '../i18n/locales/bot-messages.tr.json';
import de from '../i18n/locales/bot-messages.de.json';
import ru from '../i18n/locales/bot-messages.ru.json';
import es from '../i18n/locales/bot-messages.es.json';
import az from '../i18n/locales/bot-messages.az.json';
import ar from '../i18n/locales/bot-messages.ar.json';
import fr from '../i18n/locales/bot-messages.fr.json';
import it from '../i18n/locales/bot-messages.it.json';
import pt from '../i18n/locales/bot-messages.pt.json';
import uk from '../i18n/locales/bot-messages.uk.json';
import fa from '../i18n/locales/bot-messages.fa.json';
import id from '../i18n/locales/bot-messages.id.json';
import uz from '../i18n/locales/bot-messages.uz.json';
import { BOT_LANGUAGES } from '../bot-engine/bot-i18n.service';

/** All shipped bot-reply locale trees keyed by language code. */
const LOCALES: Record<string, unknown> = { en, tr, de, ru, es, az, ar, fr, it, pt, uk, fa, id, uz };

/** Flattens a locale tree into sorted "a.b.c" key paths. */
function flatKeys(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix].filter(Boolean);
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('bot-reply locale files', () => {
  test('every declared language ships a locale file', () => {
    for (const code of BOT_LANGUAGES) {
      expect(LOCALES[code], `locale ${code} must exist`).toBeDefined();
    }
  });

  test('all locales share the exact key tree of the English source', () => {
    const reference = flatKeys(en).sort();
    expect(reference.length).toBeGreaterThan(100);
    for (const code of Object.keys(LOCALES)) {
      expect(flatKeys(LOCALES[code]).sort()).toEqual(reference);
    }
  });

  test('interpolation placeholders are preserved per key', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const walk = (a: unknown, b: unknown, path: string) => {
      if (typeof a === 'string' && typeof b === 'string') {
        expect(placeholders(b), path).toEqual(placeholders(a));
        return;
      }
      if (a !== null && typeof a === 'object') {
        for (const [key, value] of Object.entries(a as Record<string, unknown>)) {
          walk(value, (b as Record<string, unknown>)?.[key], `${path}.${key}`);
        }
      }
    };
    for (const code of Object.keys(LOCALES)) {
      walk(en, LOCALES[code], code);
    }
  });
});
