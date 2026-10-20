export interface BroadcastRow {
  id: string;
  bot_id: string;
  target_type: string;
  message_text: string;
  media_url: string | null;
  buttons_json: string | null;
  total_recipients: number;
  success_count: number;
  failed_count: number;
  status: string;
  created_at: string | null;
  target_filter_json?: string | null;
  targetFilterJson?: string | null;
  botId: string;
  targetType: string;
  messageText: string;
  mediaUrl: string | null;
  buttonsJson: string | null;
  totalRecipients: number;
  successCount: number;
  failedCount: number;
  createdAt: string | null;
  experimentId: string | null;
  variantLabel: string | null;
  phase: string | null;
  clicks: number;
}
