import type { Broadcast } from '@prisma/client';
import type { BroadcastRow } from './broadcast.entity';

export function toBroadcastRow(b: Broadcast): BroadcastRow {
  return {
    id: b.id,
    bot_id: b.botId,
    target_type: b.targetType,
    message_text: b.messageText,
    media_url: b.mediaUrl,
    buttons_json: b.buttonsJson,
    total_recipients: b.totalRecipients,
    success_count: b.successCount,
    failed_count: b.failedCount,
    status: b.status,
    created_at: b.createdAt,
    botId: b.botId,
    targetType: b.targetType,
    messageText: b.messageText,
    mediaUrl: b.mediaUrl,
    buttonsJson: b.buttonsJson,
    totalRecipients: b.totalRecipients,
    successCount: b.successCount,
    failedCount: b.failedCount,
    createdAt: b.createdAt,
    experimentId: b.experimentId,
    variantLabel: b.variantLabel,
    phase: b.phase,
    clicks: b.clicks,
  };
}
