/**
 * Domain shape for drip subscriber with number telegram_id.
 */
export interface DripSubscriberEntity {
  bot_id: string;
  campaign_id: string;
  telegram_id: number;
  current_step: number;
  next_run_at: string | null;
  /** Consecutive transient delivery failures (unsubscribes after the limit). */
  attempts: number;
}
