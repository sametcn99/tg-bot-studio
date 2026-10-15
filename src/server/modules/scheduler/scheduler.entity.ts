export interface ScheduledPostRow {
  id: number;
  bot_id: number;
  target_chat_id: number | string;
  message_text: string;
  media_url: string | null;
  buttons_json: string | null;
  scheduled_at: string;
  status: string;
  botId: number;
  targetChatId: string;
  messageText: string;
  mediaUrl: string | null;
  buttonsJson: string | null;
  scheduledAt: string;
}
