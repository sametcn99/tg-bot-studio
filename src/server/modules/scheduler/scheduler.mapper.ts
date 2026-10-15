import type { ScheduledPost } from '@prisma/client';
import type { ScheduledPostRow } from './scheduler.entity';

export function toScheduledPostRow(p: ScheduledPost): ScheduledPostRow {
  const target = p.targetChatId;
  const targetChatId =
    target.startsWith('@') || Number.isNaN(Number(target)) ? target : Number(target);
  return {
    id: p.id,
    bot_id: p.botId,
    target_chat_id: targetChatId,
    message_text: p.messageText,
    media_url: p.mediaUrl,
    buttons_json: p.buttonsJson,
    scheduled_at: p.scheduledAt,
    status: p.status,
    botId: p.botId,
    targetChatId: p.targetChatId,
    messageText: p.messageText,
    mediaUrl: p.mediaUrl,
    buttonsJson: p.buttonsJson,
    scheduledAt: p.scheduledAt,
  };
}
