/**
 * Placeholder template rendering shared by every messaging module.
 * @module common/utils/template
 */

/**
 * Placeholder values available to message templates.
 * @interface TemplateContext
 * @property {string} [first_name] - User's Telegram first name.
 * @property {string} [last_name] - User's Telegram last name.
 * @property {string} [username] - User's Telegram @username (without @).
 * @property {string|number} [user_id] - Telegram numeric user id.
 * @property {string} [mention] - Ready-to-send HTML mention link.
 * @property {string} [group_name] - Title of the group or channel chat.
 * @property {string} [bot_name] - Display name of the bot.
 * @property {string} [date] - Current date in ISO format.
 * @property {string} [time] - Current UTC time in HH:mm format.
 * @property {number} [rank] - Leaderboard position (1-based).
 * @property {string} [medal] - Medal emoji for the top three ranks.
 * @property {string} [name] - Display name used by leaderboard rows.
 * @property {number|string} [score] - Weighted activity score.
 * @property {number|string} [messages] - Message count in the period.
 * @property {number|string} [replies] - Reply count in the period.
 * @property {number|string} [media] - Media message count in the period.
 * @property {string} [period_label] - Human label of the leaderboard period.
 * @property {string} [first] - reference-style alias of `first_name`.
 * @property {string} [last] - reference-style alias of `last_name`.
 * @property {string} [fullname] - First + last name combined.
 * @property {string} [chatname] - reference-style alias of `group_name`.
 * @property {string|number} [chat_id] - Telegram chat id of the target chat.
 * @property {string|number} [count] - Generic counter (warns, purge count, ...).
 * @property {string} [reason] - Reason text attached to a moderation action.
 * @property {string} [rules] - Rules button URL or link text for the chat.
 */
export interface TemplateContext {
  first_name?: string;
  last_name?: string;
  username?: string;
  user_id?: string | number;
  mention?: string;
  group_name?: string;
  bot_name?: string;
  date?: string;
  time?: string;
  rank?: number;
  medal?: string;
  name?: string;
  score?: number | string;
  messages?: number | string;
  replies?: number | string;
  media?: number | string;
  period_label?: string;
  first?: string;
  last?: string;
  fullname?: string;
  chatname?: string;
  chat_id?: string | number;
  count?: number | string;
  reason?: string;
  rules?: string;
}

/**
 * Renders a message template by substituting `{placeholder}` tags with values
 * from the context. Unknown placeholders are left untouched.
 *
 * @param {string} template - Raw template text containing placeholders.
 * @param {TemplateContext} context - Values injected into the template.
 * @returns {string} Rendered message text safe for HTML parse mode.
 * @example
 * renderTemplate('Hello {mention}, welcome to {group_name}!', ctx);
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const resolved: TemplateContext = { ...context };
  // reference-style aliases resolve to their canonical fields when absent.
  resolved.first ??= context.first_name;
  resolved.last ??= context.last_name;
  resolved.chatname ??= context.group_name;
  resolved.fullname ??= [context.first_name, context.last_name]
    .filter((part) => part && part.trim())
    .join(' ');

  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in resolved && resolved[key as keyof TemplateContext] !== undefined
      ? String(resolved[key as keyof TemplateContext])
      : match,
  );
}
