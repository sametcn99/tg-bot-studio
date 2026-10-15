export interface AutoresponderRow {
  id: number;
  bot_id: number;
  command: string;
  response_text: string;
  media_url: string | null;
  buttons_json: string | null;
  is_active: number;
  chat_id: string | null;
  scope: string;
  match_mode: string;
  admin_only: number;
  repeat_seconds: number;
  botId: number;
  responseText: string;
  mediaUrl: string | null;
  buttonsJson: string | null;
  isActive: number;
  chatId: string | null;
  matchMode: string;
  adminOnly: number;
  repeatSeconds: number;
}
