import type { MediaAsset } from '@prisma/client';
import type { MediaAssetRow } from './media-asset.entity';

export function toMediaAssetRow(a: MediaAsset): MediaAssetRow {
  return {
    id: a.id,
    botId: a.botId,
    name: a.name,
    source: a.source,
    value: a.value,
    kind: a.kind,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    tags: a.tags,
    createdAt: a.createdAt,
  };
}
