/**
 * Domain shape for support message with number IDs.
 */
export interface SupportMessageEntity {
  id: number;
  bot_id: number;
  telegram_id: number;
  user_message_id: number | null;
  admin_chat_id: number | null;
  forum_topic_id: number | null;
  direction: string;
  sender_name: string | null;
  message_text: string | null;
  media_type: string | null;
  created_at: string | null;
}

/**
 * Domain shape for support thread summary.
 */
export interface SupportThreadEntity {
  telegram_id: number;
  sender_name: string | null;
  message_count: number;
  last_activity: string | null;
  last_message: string | null;
}
