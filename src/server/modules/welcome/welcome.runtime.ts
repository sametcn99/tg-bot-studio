import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { renderTemplate } from '../../common/utils/template.util';

/**
 * Runtime for the Group Welcome & Clean Chat module. Greets new members with
 * placeholder templates, optionally auto-deletes the greeting, and removes
 * Telegram join/leave service messages to keep the chat clean.
 */
@Injectable()
export class WelcomeRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'welcome';

  /**
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(registry: ModuleHandlerRegistry) {
    super();
    registry.register(this);
  }

  /**
   * Attaches new-member greeting middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const config = ctx.config;

    bot.on('message:new_chat_members', async (update) => {
      const members = update.msg.new_chat_members ?? [];
      const template = String(config.template ?? 'Welcome {mention} to {group_name}!');

      for (const member of members) {
        if (member.is_bot) continue;
        const text = renderTemplate(template, {
          first_name: member.first_name,
          last_name: member.last_name,
          username: member.username,
          user_id: member.id,
          mention: member.username
            ? `@${member.username}`
            : `<a href="tg://user?id=${member.id}">${member.first_name}</a>`,
          group_name: update.chat.title ?? 'the group',
          bot_name: bot.botInfo?.first_name ?? '',
          date: new Date().toISOString().slice(0, 10),
          time: new Date().toISOString().slice(11, 16),
        });

        const sent = await update.reply(text, { parse_mode: 'HTML' });
        const autoDelete = Number(config.autoDeleteSeconds ?? 0);
        if (autoDelete >= 15 && autoDelete <= 120) {
          setTimeout(() => {
            void bot.api.deleteMessage(update.chat.id, sent.message_id).catch(() => undefined);
          }, autoDelete * 1000);
        }
      }

      if (config.deleteServiceMessages !== false) {
        await update.deleteMessage().catch(() => undefined);
      }
    });

    bot.on('message:left_chat_member', (update) => {
      if (config.deleteLeaveMessages === true) {
        void update.deleteMessage().catch(() => undefined);
      }
    });
  }
}
