/**
 * Domain shape for VIP subscription with number IDs.
 */
export interface VipSubscriptionEntity {
  id: number;
  bot_id: number;
  telegram_id: number;
  channel_id: number;
  expires_at: string;
  is_active: number;
}
