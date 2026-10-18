import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { BotI18nService, BOT_LANGUAGES, type BotLanguage } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';

/** Display labels for /setlang buttons (mirrors the shipped locale files). */
const LANGUAGE_LABELS: Record<BotLanguage, string> = {
  en: 'English 🇬🇧',
  tr: 'Türkçe 🇹🇷',
  de: 'Deutsch 🇩🇪',
  ru: 'Русский 🇷🇺',
  es: 'Español 🇪🇸',
  az: 'Azərbaycan dili 🇦🇿',
  ar: 'العربية 🇸🇦',
  fr: 'Français 🇫🇷',
  it: 'Italiano 🇮🇹',
  pt: 'Português 🇧🇷',
  uk: 'Українська 🇺🇦',
  fa: 'فارسی 🇮🇷',
  id: 'Indonesia 🇮🇩',
  uz: 'Oʻzbekcha 🇺🇿',
};

/**
 * Runtime for the Bot Reply Language module: /setlang picks the group's
 * language via inline buttons, driving every localized bot message
 * (moderation, captcha, federation, ...).
 */
@Injectable()
export class LanguageRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'language';

  /**
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly i18n: BotI18nService,
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the /setlang command and its callback buttons.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.command('setlang', async (c) => {
      if (
        !c.chat ||
        (c.chat.type !== 'supergroup' && c.chat.type !== 'group' && c.chat.type !== 'private')
      ) {
        return;
      }
      // Explicit-target gate: only configured chats manage their language.
      if (!(await this.chatSettings.isTargeted(botId, c.chat.id, this.moduleKey))) return;
      const lang = await this.i18n.getChatLanguage(botId, c.chat.id);
      const args = String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase();

      if (args) {
        await this.apply(c, botId, args, lang);
        return;
      }
      const keyboard = new InlineKeyboard();
      BOT_LANGUAGES.forEach((code, index) => {
        keyboard.text(LANGUAGE_LABELS[code], `lang:set:${code}`);
        // Two buttons per row keeps the picker compact on mobile.
        if (index % 2 === 1) keyboard.row();
      });
      await c
        .reply(this.i18n.t(lang, 'language.choose'), { reply_markup: keyboard })
        .catch(() => undefined);
    });

    bot.callbackQuery(/^lang:set:(\w+)$/, async (c) => {
      const chatId = c.callbackQuery.message?.chat.id;
      if (!chatId) return;
      const lang = await this.i18n.getChatLanguage(botId, chatId);
      await this.apply(
        {
          reply: (text: string) => c.api.sendMessage(chatId, text),
          chat: { id: chatId },
        } as never,
        botId,
        String(c.match[1]),
        lang,
      );
      await c.answerCallbackQuery().catch(() => undefined);
    });

    void bot;
  }

  /**
   * Applies and confirms a language choice.
   */
  private async apply(
    c: { reply: (text: string) => Promise<unknown>; chat: { id: number } },
    botId: string,
    requested: string,
    fallbackLang: BotLanguage,
  ): Promise<void> {
    const language = (BOT_LANGUAGES as readonly string[]).includes(requested)
      ? (requested as BotLanguage)
      : null;
    if (!language) {
      await c.reply(this.i18n.t(fallbackLang, 'language.unsupported')).catch(() => undefined);
      return;
    }
    await this.i18n.setChatLanguage(botId, c.chat.id, language);
    await c.reply(this.i18n.t(language, 'language.set', { lang: language })).catch(() => undefined);
  }
}
