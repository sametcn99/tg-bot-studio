/**
 * Aggregated activity leaderboard entry.
 */
export interface LeaderboardEntryEntity {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  messages: number;
  replies: number;
  media: number;
  score: number;
}

export interface ScoreScheduleRow {
  id: string;
  bot_id: string;
  name: string;
  chat_ids_json: string;
  period: string;
  frequency: string;
  time_of_day: string | null;
  day_of_week: number | null;
  run_at: string;
  top_limit: number;
  header_text: string | null;
  row_template: string | null;
  footer_text: string | null;
  parse_mode: string | null;
  medals: number;
  disable_notification: number;
  status: string;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string | null;
  botId: string;
  chatIdsJson: string;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  runAt: string;
  topLimit: number;
  headerText: string | null;
  rowTemplate: string | null;
  footerText: string | null;
  parseMode: string | null;
  disableNotification: number;
  lastRunAt: string | null;
  lastResult: string | null;
  createdAt: string | null;
}
