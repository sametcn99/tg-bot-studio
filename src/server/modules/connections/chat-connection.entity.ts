/**
 * Domain shape for bot group with numeric chatId.
 */
export interface BotGroupEntity {
  chat_id: number;
  title: string;
  type: string;
  is_active: number;
}
