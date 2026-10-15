/**
 * Domain shape for drip subscriber with number telegram_id.
 */
export interface DripSubscriberEntity {
  bot_id: number;
  campaign_id: number;
  telegram_id: number;
  current_step: number;
  next_run_at: string | null;
}
