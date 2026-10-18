/**
 * Domain shape for VIP subscription with number IDs.
 */
export interface VipSubscriptionEntity {
  id: string;
  bot_id: string;
  telegram_id: number;
  channel_id: number;
  expires_at: string;
  is_active: number;
}
