import { describe, expect, test } from 'bun:test';
import {
  buildMessageLink,
  detectQuestion,
  extractMedia,
  matchFiles,
  normalizeForSearch,
  tokenizeQuery,
} from '../modules/file-search/search-logic';
import type { Message } from 'grammy/types';

describe('normalizeForSearch', () => {
  test('folds Turkish capitals and dotless ı', () => {
    expect(normalizeForSearch('BAŞVURU Formu')).toBe('basvuru formu');
    expect(normalizeForSearch('kısa')).toBe('kisa');
    expect(normalizeForSearch('İSTANBUL')).toBe('istanbul');
  });

  test('collapses whitespace and trims', () => {
    expect(normalizeForSearch('  a   b  ')).toBe('a b');
  });
});

describe('detectQuestion', () => {
  test('detects Turkish question forms and extracts the query', () => {
    const hit = detectQuestion('staj başvuru formu olan var mı acaba');
    expect(hit?.tokens).toEqual(['staj', 'basvuru', 'formu']);
    expect(hit?.query).toBe('staj başvuru formu');
  });

  test('detects joined and accent-less variants', () => {
    expect(detectQuestion('not defteri varmi')?.tokens).toEqual(['not', 'defteri']);
    expect(detectQuestion('rapor var mi?')?.tokens).toEqual(['rapor']);
  });

  test('detects kimde var / yok mu / misin request forms', () => {
    expect(detectQuestion('döküman kimde var')).not.toBeNull();
    expect(detectQuestion('şu yok mu burada')).not.toBeNull();
    expect(detectQuestion('faturayı gönderebilir misin')).not.toBeNull();
  });

  test('detects English question forms', () => {
    expect(detectQuestion('does anyone have the invoice pdf')?.tokens).toEqual(['invoice', 'pdf']);
    expect(detectQuestion('is there a user manual?')).not.toBeNull();
    expect(detectQuestion('looking for the setup guide')).not.toBeNull();
  });

  test('ignores statements, commands, and empty questions', () => {
    expect(detectQuestion('bugün hava güzel')).toBeNull();
    expect(detectQuestion('ben geldim arkadaşlar')).toBeNull();
    expect(detectQuestion('/ara formu')).toBeNull();
    expect(detectQuestion('var mı')).toBeNull();
    expect(detectQuestion('')).toBeNull();
  });

  test('honours extra patterns and builtIn toggle', () => {
    expect(detectQuestion('kto ma plik X', { extraPatterns: ['\\bkto ma\\b'] })).not.toBeNull();
    expect(detectQuestion('formu var mı', { builtIn: false })).toBeNull();
    // Invalid regex sources are skipped, not fatal.
    expect(detectQuestion('formu var mı', { extraPatterns: ['(['] })).not.toBeNull();
  });
});

describe('tokenizeQuery', () => {
  test('drops stopwords and short fragments', () => {
    expect(tokenizeQuery('Lütfen bir staj formu gönderir misin')).toEqual(['staj', 'formu']);
  });
});

describe('matchFiles', () => {
  const rows = [
    { id: 'new', searchText: 'staj basvuru formu.pdf' },
    { id: 'plain', searchText: 'basvuru form.pdf' },
    { id: 'other', searchText: 'rapor 2024.xlsx' },
  ];

  test('all mode requires every token', () => {
    expect(matchFiles(rows, ['staj', 'formu'], 'all').map((r) => r.id)).toEqual(['new']);
  });

  test('suffix-tolerant word fallback matches formu against form', () => {
    expect(matchFiles(rows, ['formu'], 'all').map((r) => r.id)).toEqual(['new', 'plain']);
  });

  test('any mode matches on one hit and preserves order', () => {
    expect(matchFiles(rows, ['basvuru', '2024'], 'any').map((r) => r.id)).toEqual([
      'new',
      'plain',
      'other',
    ]);
  });

  test('no tokens matches nothing', () => {
    expect(matchFiles(rows, [], 'all')).toEqual([]);
  });
});

describe('buildMessageLink', () => {
  test('prefers public username links', () => {
    expect(buildMessageLink(-100123456789, 42, 'mygroup')).toBe('https://t.me/mygroup/42');
  });

  test('builds /c/ links for supergroups', () => {
    expect(buildMessageLink(-100123456789, 42)).toBe('https://t.me/c/123456789/42');
  });

  test('returns null for basic groups and private chats', () => {
    expect(buildMessageLink(-987654321, 42)).toBeNull();
    expect(buildMessageLink(12345, 42)).toBeNull();
  });
});

describe('extractMedia', () => {
  const base = { message_id: 1, date: 1700000000, chat: { id: 1, type: 'group' } };

  test('extracts document metadata', () => {
    const msg = {
      ...base,
      document: {
        file_id: 'f1',
        file_name: 'Rapor.pdf',
        mime_type: 'application/pdf',
        file_size: 10,
      },
    } as unknown as Message;
    expect(extractMedia(msg)).toEqual({
      kind: 'document',
      fileName: 'Rapor.pdf',
      fileId: 'f1',
      mimeType: 'application/pdf',
      fileSize: 10,
    });
  });

  test('extracts the largest photo without a filename', () => {
    const msg = {
      ...base,
      photo: [
        { file_id: 'p1', width: 1, height: 1 },
        { file_id: 'p2', width: 2, height: 2, file_size: 2048 },
      ],
    } as unknown as Message;
    const media = extractMedia(msg);
    expect(media?.kind).toBe('photo');
    expect(media?.fileId).toBe('p2');
    expect(media?.fileName).toBeNull();
  });

  test('ignores text-only and sticker messages', () => {
    expect(extractMedia({ ...base, text: 'selam' } as unknown as Message)).toBeNull();
    expect(extractMedia({ ...base, sticker: { file_id: 's1' } } as unknown as Message)).toBeNull();
  });
});
