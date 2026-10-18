/**
 * Domain shape for mini app order with numeric telegram_id.
 */
export interface MiniAppOrderEntity {
  id: string;
  bot_id: string;
  app_id: string;
  telegram_id: number;
  total_amount: number;
  currency: string;
  items_json: string;
  status: string;
  created_at: string | null;
}
