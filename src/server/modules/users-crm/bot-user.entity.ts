/**
 * Domain shape for bot user data with numeric telegram_id.
 */
export interface BotUserEntity {
  bot_id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  points: number;
  referrer_id: number | null;
  tags_json: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  botId: number;
  telegramId: number;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  referrerId: number | null;
  tagsJson: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}
