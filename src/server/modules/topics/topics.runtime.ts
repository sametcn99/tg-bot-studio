import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { BotI18nService, type BotLanguage } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';

/**
 * Runtime for the Forum Topic Management module: create, rename, close,
 * reopen, and delete topics from inside the forum, and route the bot's own
 * messages (greetings, announcements) to a designated action topic.
 */
@Injectable()
export class TopicsRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'topics';

  /**
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly adminGate: AdminGateService,
    private readonly i18n: BotI18nService,
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the topic management commands.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.command('newtopic', (c) => this.withGuard(c, botId, async (chatId, lang, args) => {
      if (!args) return;
      const created = await bot.api.createForumTopic(chatId, args).catch(() => null);
      if (created) {
        await c.reply(this.i18n.t(lang, 'topics.created', { name: args })).catch(() => undefined);
      }
    }));

    bot.command('renametopic', (c) => this.withGuard(c, botId, async (chatId, lang, args) => {
      if (!args || !c.msg?.is_topic_message) return;
      const threadId = c.msg.message_thread_id!;
      const ok = await bot.api
        .editForumTopic(chatId, threadId, { name: args })
        .catch(() => false);
      if (ok) {
        await c.reply(this.i18n.t(lang, 'topics.renamed', { name: args })).catch(() => undefined);
      }
    }));

    bot.command('closetopic', (c) => this.withGuard(c, botId, async (chatId, lang) => {
      if (!c.msg?.is_topic_message) return;
      const ok = await bot.api
        .closeForumTopic(chatId, c.msg.message_thread_id!)
        .catch(() => false);
      if (ok) {
        await c.reply(this.i18n.t(lang, 'topics.closed')).catch(() => undefined);
      }
    }));

    bot.command('reopentopic', (c) => this.withGuard(c, botId, async (chatId, lang) => {
      if (!c.msg?.is_topic_message) return;
      const ok = await bot.api
        .reopenForumTopic(chatId, c.msg.message_thread_id!)
        .catch(() => false);
      if (ok) {
        await c.reply(this.i18n.t(lang, 'topics.reopened')).catch(() => undefined);
      }
    }));

    bot.command('deletetopic', (c) => this.withGuard(c, botId, async (chatId, lang) => {
      if (!c.msg?.is_topic_message) return;
      const ok = await bot.api
        .deleteForumTopic(chatId, c.msg.message_thread_id!)
        .catch(() => false);
      if (ok) {
        await c.reply(this.i18n.t(lang, 'topics.deleted')).catch(() => undefined);
      }
    }));

    bot.command('actiontopic', (c) => this.withGuard(c, botId, async (chatId, lang) => {
      const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
      await c
        .reply(`Action topic: ${Number(config.actionTopicId ?? 0) || this.i18n.t(lang, 'common.error')}`)
        .catch(() => undefined);
    }));

    bot.command('setactiontopic', (c) => this.withGuard(c, botId, async (chatId, lang) => {
      if (!c.msg?.is_topic_message) {
        await c.reply(this.i18n.t(lang, 'topics.forumOnly')).catch(() => undefined);
        return;
      }
      const threadId = c.msg.message_thread_id;
      const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
      await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
        ...override,
        actionTopicId: threadId,
      });
      await c.reply(this.i18n.t(lang, 'topics.actionTopicSet')).catch(() => undefined);
    }));
  }

  /**
   * Shared guard: forum-adjacent group + manage_topics capability.
   */
  private async withGuard(
    c: import('grammy').Context,
    botId: number,
    handler: (chatId: number, lang: BotLanguage, args: string) => Promise<void>,
  ): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (!c.from) return;
    const chatId = c.chat.id;
    if (!(await this.adminGate.hasCapability(c.api, chatId, c.from.id, 'manage_topics'))) {
      return;
    }
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    await handler(chatId, lang, args);
  }
}
