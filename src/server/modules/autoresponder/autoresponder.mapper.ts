import type { Autoresponder } from '@prisma/client';
import type { AutoresponderRow } from './autoresponder.entity';

export function toAutoresponderRow(item: Autoresponder): AutoresponderRow {
  const hasBytes = Boolean(item.mediaData && (item.mediaData as Buffer).length > 0);
  const mediaUrl = hasBytes
    ? `/api/bots/${item.botId}/autoresponders/${item.id}/media`
    : item.mediaUrl;

  return {
    id: item.id,
    bot_id: item.botId,
    command: item.command,
    response_text: item.responseText,
    media_url: mediaUrl,
    media_data: item.mediaData,
    media_mime: item.mediaMime,
    media_file_name: item.mediaFileName,
    buttons_json: item.buttonsJson,
    is_active: item.isActive,
    chat_id: item.chatId,
    scope: item.scope,
    match_mode: item.matchMode,
    admin_only: item.adminOnly,
    repeat_seconds: item.repeatSeconds,
    delete_previous_response: item.deletePreviousResponse,
    reply_to_message: item.replyToMessage ?? 0,
    botId: item.botId,
    responseText: item.responseText,
    mediaUrl,
    mediaData: item.mediaData,
    mediaMime: item.mediaMime,
    mediaFileName: item.mediaFileName,
    buttonsJson: item.buttonsJson,
    isActive: item.isActive,
    chatId: item.chatId,
    matchMode: item.matchMode,
    adminOnly: item.adminOnly,
    repeatSeconds: item.repeatSeconds,
    deletePreviousResponse: item.deletePreviousResponse,
    replyToMessage: item.replyToMessage ?? 0,
  };
}
