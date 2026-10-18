export interface ScheduledPostRow {
  id: string;
  bot_id: string;
  target_chat_id: string | number;
  message_text: string;
  media_url: string | null;
  buttons_json: string | null;
  scheduled_at: string;
  status: string;
  botId: string;
  targetChatId: string;
  messageText: string;
  mediaUrl: string | null;
  buttonsJson: string | null;
  scheduledAt: string;
}
