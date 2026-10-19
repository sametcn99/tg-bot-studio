import { describe, expect, test } from 'bun:test';
import {
  fromGramjsMessage,
  toBackfillEntry,
  type BackfillIndexEntry,
  type MtprotoMessageLike,
} from '../modules/file-search/backfill/mtproto-message';

/** Document attribute factory keeping fixtures terse. */
function attr(className: string, extra: Record<string, unknown> = {}) {
  return { className, ...extra };
}

/** Builds a media message fixture. */
function mediaMessage(
  id: number,
  media: MtprotoMessageLike['media'],
  caption?: string,
  fromId?: number,
): MtprotoMessageLike {
  return {
    id,
    date: 1_700_000_000,
    message: caption,
    media,
    fromId: fromId !== undefined ? { userId: fromId } : null,
  };
}

describe('toBackfillEntry', () => {
  test('extracts a plain document with filename', () => {
    const entry = toBackfillEntry(
      mediaMessage(10, {
        className: 'MessageMediaDocument',
        document: {
          mimeType: 'application/pdf',
          size: 2048,
          attributes: [attr('DocumentAttributeFilename', { fileName: 'Staj Formu.pdf' })],
        },
      }),
    );
    expect(entry).toMatchObject({
      messageId: 10,
      kind: 'document',
      fileName: 'Staj Formu.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      senderId: null,
      searchText: 'staj formu.pdf',
    });
  });

  test('detects voice, audio, video, video note and animation kinds', () => {
    const kinds: Array<
      [
        Array<{ className: string; voice?: boolean; spherical?: boolean }>,
        BackfillIndexEntry['kind'],
      ]
    > = [
      [[attr('DocumentAttributeAudio', { voice: true })], 'voice'],
      [[attr('DocumentAttributeAudio')], 'audio'],
      [[attr('DocumentAttributeVideo')], 'video'],
      [[attr('DocumentAttributeVideo', { spherical: true })], 'video_note'],
      [[attr('DocumentAttributeVideo'), attr('DocumentAttributeAnimated')], 'animation'],
    ];
    for (const [attributes, expected] of kinds) {
      const entry = toBackfillEntry(
        mediaMessage(
          1,
          {
            className: 'MessageMediaDocument',
            document: { mimeType: 'video/mp4', size: 100, attributes },
          },
          'kayıt',
        ),
      );
      expect(entry?.kind).toBe(expected);
    }
  });

  test('indexes caption-only photos', () => {
    const entry = toBackfillEntry(
      mediaMessage(5, { className: 'MessageMediaPhoto', photo: {} }, 'Menü Foto', 99),
    );
    expect(entry).toMatchObject({
      kind: 'photo',
      fileName: null,
      caption: 'Menü Foto',
      senderId: '99',
    });
  });

  test('skips text-only, sticker, and text-less media', () => {
    expect(toBackfillEntry(mediaMessage(1, null, 'selam'))).toBeNull();
    expect(
      toBackfillEntry(
        mediaMessage(2, {
          className: 'MessageMediaDocument',
          document: {
            mimeType: 'image/webp',
            attributes: [
              attr('DocumentAttributeSticker'),
              attr('DocumentAttributeFilename', { fileName: 'st.webp' }),
            ],
          },
        }),
      ),
    ).toBeNull();
    expect(
      toBackfillEntry(mediaMessage(3, { className: 'MessageMediaPhoto', photo: {} })),
    ).toBeNull();
  });

  test('folds Turkish in the search text', () => {
    const entry = toBackfillEntry(
      mediaMessage(7, {
        className: 'MessageMediaDocument',
        document: {
          mimeType: 'application/pdf',
          attributes: [attr('DocumentAttributeFilename', { fileName: 'BAŞVURU Formu.pdf' })],
        },
      }),
    );
    expect(entry?.searchText).toBe('basvuru formu.pdf');
  });
});

describe('fromGramjsMessage', () => {
  test('flattens a GramJS message', () => {
    const flat = fromGramjsMessage({
      id: 42,
      date: 1_700_000_000,
      message: 'capt',
      media: { className: 'MessageMediaPhoto', photo: {} },
      fromId: { userId: 7 },
    });
    expect(flat).toEqual({
      id: 42,
      date: 1_700_000_000,
      message: 'capt',
      media: { className: 'MessageMediaPhoto', photo: {} },
      fromId: { userId: 7 },
    });
    expect(toBackfillEntry(flat)?.kind).toBe('photo');
  });
});
