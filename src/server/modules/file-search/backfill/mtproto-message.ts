/**
 * Pure adapter turning normalized MTProto (GramJS) message shapes into
 * file-search index rows. Structural typing keeps this testable without the
 * `telegram` package: the backfill worker flattens real GramJS objects into
 * {@link MtprotoMessageLike} before calling {@link toBackfillEntry}.
 * @module modules/file-search/backfill/mtproto-message
 */
import { normalizeForSearch } from '../search-logic';

/** Structural stand-in for a GramJS media payload. */
export interface MtprotoMediaLike {
  /** GramJS class discriminator: MessageMediaDocument | MessageMediaPhoto. */
  className: string;
  document?: {
    mimeType?: string;
    /** Long or number depending on the serialization path. */
    size?: unknown;
    attributes?: Array<{
      className: string;
      fileName?: string;
      /** DocumentAttributeAudio flags. */
      voice?: boolean;
      /** DocumentAttributeVideo flag for video notes. */
      spherical?: boolean;
    }>;
  };
  photo?: unknown;
}

/** Structural stand-in for a GramJS Api.Message. */
export interface MtprotoMessageLike {
  id: number;
  date: number;
  /** Caption (media) or text (no media) — only caption is used here. */
  message?: string;
  media?: MtprotoMediaLike | null;
  fromId?: { userId?: unknown } | null;
}

/** One indexable file extracted from history. */
export interface BackfillIndexEntry {
  messageId: number;
  kind: 'document' | 'video' | 'audio' | 'voice' | 'video_note' | 'animation' | 'photo';
  fileName: string | null;
  caption: string | null;
  mimeType: string | null;
  fileSize: number | null;
  senderId: string | null;
  sentAt: string;
  searchText: string;
}

/**
 * Maps a document's attributes onto the module's media kind (mirrors the
 * Bot API semantics the live indexer produces).
 *
 * @param {string} mimeType - Document mime type.
 * @param {Array<object>} attributes - Document attributes.
 * @returns {string} Media kind.
 */
function documentKind(
  mimeType: string | undefined,
  attributes: Array<{ className: string; voice?: boolean; spherical?: boolean }>,
): BackfillIndexEntry['kind'] {
  const has = (name: string): boolean => attributes.some((attr) => attr.className === name);
  if (has('DocumentAttributeAudio') && attributes.some((attr) => attr.voice === true)) {
    return 'voice';
  }
  if (has('DocumentAttributeAudio')) return 'audio';
  if (has('DocumentAttributeAnimated')) return 'animation';
  if (has('DocumentAttributeVideo')) {
    return attributes.some((attr) => attr.spherical === true) ? 'video_note' : 'video';
  }
  void mimeType;
  return 'document';
}

/**
 * Converts one history message into an index entry (null for text-only,
 * service, sticker, or media without any searchable text).
 *
 * @param {MtprotoMessageLike} msg - Normalized history message.
 * @returns {BackfillIndexEntry | null} Entry when indexable.
 */
export function toBackfillEntry(msg: MtprotoMessageLike): BackfillIndexEntry | null {
  const media = msg.media ?? null;
  if (!media) return null;

  const caption = msg.message?.trim() || null;
  let kind: BackfillIndexEntry['kind'];
  let fileName: string | null = null;
  let mimeType: string | null;
  let fileSize: number | null = null;

  if (media.className === 'MessageMediaPhoto' && media.photo) {
    kind = 'photo';
    mimeType = 'image/jpeg';
  } else if (media.className === 'MessageMediaDocument' && media.document) {
    const document = media.document;
    mimeType = document.mimeType ?? null;
    // Sticker documents (image/webp + sticker attribute) are not searchable files.
    const isSticker =
      document.attributes?.some((attr) => attr.className === 'DocumentAttributeSticker') === true;
    if (isSticker) return null;
    fileName =
      document.attributes?.find((attr) => attr.className === 'DocumentAttributeFilename')
        ?.fileName ?? null;
    const size = Number(document.size ?? NaN);
    fileSize = Number.isFinite(size) ? size : null;
    kind = documentKind(document.mimeType, document.attributes ?? []);
  } else {
    return null;
  }

  if (!fileName && !caption) return null;
  const searchText = normalizeForSearch([fileName, caption].filter(Boolean).join(' '));
  if (!searchText) return null;

  const senderIdRaw = Number(msg.fromId?.userId ?? NaN);
  return {
    messageId: msg.id,
    kind,
    fileName,
    caption,
    mimeType,
    fileSize,
    senderId: Number.isFinite(senderIdRaw) ? String(senderIdRaw) : null,
    sentAt: new Date(msg.date * 1000).toISOString(),
    searchText,
  };
}

/**
 * Flattens a real GramJS Api.Message into the structural adapter input.
 * @param {object} message - GramJS message instance.
 * @returns {MtprotoMessageLike} Normalized shape.
 */
export function fromGramjsMessage(message: {
  id: number;
  date: number;
  message?: string;
  media?: unknown;
  fromId?: unknown;
}): MtprotoMessageLike {
  const media = message.media as MtprotoMediaLike | undefined;
  const fromId = message.fromId as { userId?: unknown } | undefined;
  return {
    id: message.id,
    date: message.date,
    message: message.message,
    media: media ?? null,
    fromId: fromId ?? null,
  };
}
