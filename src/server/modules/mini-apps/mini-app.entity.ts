/**
 * Domain shape for mini app order with numeric telegram_id.
 */
export interface MiniAppOrderEntity {
  id: number;
  bot_id: number;
  app_id: number;
  telegram_id: number;
  total_amount: number;
  currency: string;
  items_json: string;
  status: string;
  created_at: string | null;
}
