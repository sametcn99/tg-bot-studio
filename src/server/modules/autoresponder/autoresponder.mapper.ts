import type { Autoresponder } from '@prisma/client';
import type { AutoresponderRow } from './autoresponder.entity';

export function toAutoresponderRow(item: Autoresponder): AutoresponderRow {
  return {
    id: item.id,
    bot_id: item.botId,
    command: item.command,
    response_text: item.responseText,
    media_url: item.mediaUrl,
    buttons_json: item.buttonsJson,
    is_active: item.isActive,
    chat_id: item.chatId,
    scope: item.scope,
    match_mode: item.matchMode,
    admin_only: item.adminOnly,
    repeat_seconds: item.repeatSeconds,
    botId: item.botId,
    responseText: item.responseText,
    mediaUrl: item.mediaUrl,
    buttonsJson: item.buttonsJson,
    isActive: item.isActive,
    chatId: item.chatId,
    matchMode: item.matchMode,
    adminOnly: item.adminOnly,
    repeatSeconds: item.repeatSeconds,
  };
}
