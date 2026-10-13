import { Injectable } from '@nestjs/common';
import { InlineKeyboard, type Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { renderTemplate, type TemplateContext } from '../../common/utils/template.util';
import { StartMenuService, type MenuItemRow } from './start-menu.service';

/**
 * Runtime for the consolidated Start Menu module. Renders the /start menu
 * (and an optional /menu re-open command) from active items — chat folder
 * (addlist) links, channels, groups, and web destinations — in flat or
 * sectioned style with configurable button layout, placeholder-aware header
 * text, and click tracking through the redirect endpoint when a public base
 * URL is configured.
 */
@Injectable()
export class StartMenuRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'start-menu';

  /**
   * @param {StartMenuService} menuService - Menu item CRUD service.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly menuService: StartMenuService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the start menu commands to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;

    bot.command('start', async (update: Context) => {
      if (update.chat?.type !== 'private') return;
      await this.sendMenu(ctx, update);
    });

    if (ctx.config.enableMenuCommand) {
      bot.command('menu', async (update: Context) => {
        if (update.chat?.type !== 'private') return;
        await this.sendMenu(ctx, update);
      });
    }
  }

  /**
   * Renders and sends the menu for a triggering update.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @param {Context} update - grammY context of the triggering command.
   * @returns {Promise<void>} Resolves once the menu is delivered.
   */
  private async sendMenu(ctx: ModuleRuntimeContext, update: Context): Promise<void> {
    const items = (await this.menuService.list(ctx.botId)).filter((item) => item.is_active);
    if (items.length === 0) return;

    const from = update.from;
    const header = renderTemplate(
      String(ctx.config.startMessage ?? 'Welcome. Choose a destination:'),
      this.templateContextFor(update, from, ctx),
    );

    const publicBaseUrl = String(ctx.config.publicBaseUrl ?? '').replace(/\/+$/, '');
    const track = Boolean(ctx.config.trackClicks) && publicBaseUrl.length > 0;
    const buildUrl = (item: MenuItemRow): string =>
      track ? `${publicBaseUrl}/api/go/${item.id}` : item.url;
    const perRow = Math.min(4, Math.max(1, Number(ctx.config.buttonsPerRow ?? 1) || 1));

    if (String(ctx.config.menuStyle) === 'categorized') {
      const groups = new Map<string, MenuItemRow[]>();
      for (const item of items) {
        const bucket = groups.get(item.type) ?? [];
        bucket.push(item);
        groups.set(item.type, bucket);
      }
      let text = `${header}\n`;
      for (const [type, groupItems] of groups) {
        text += `\n<b>${this.labelForType(type)}</b>\n`;
        text += groupItems.map((item) => `- ${item.title}`).join('\n');
      }
      const keyboard = new InlineKeyboard();
      for (const groupItems of groups.values()) {
        groupItems.forEach((item, index) => {
          keyboard.url(item.title, buildUrl(item));
          if ((index + 1) % perRow === 0 || index === groupItems.length - 1) keyboard.row();
        });
      }
      await update.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    const keyboard = new InlineKeyboard();
    items.forEach((item, index) => {
      keyboard.url(item.title, buildUrl(item));
      if ((index + 1) % perRow === 0 || index === items.length - 1) keyboard.row();
    });
    await update.reply(header, { parse_mode: 'HTML', reply_markup: keyboard });
  }

  /**
   * Builds placeholder values for the header template.
   * @param {Context} update - Triggering update.
   * @param {Context['from'] | undefined} from - Author of the update, when present.
   * @param {ModuleRuntimeContext} ctx - Runtime context (bot identity).
   * @returns {TemplateContext} Placeholder values.
   */
  private templateContextFor(
    update: Context,
    from: Context['from'] | undefined,
    ctx: ModuleRuntimeContext,
  ): TemplateContext {
    const now = new Date().toISOString();
    return {
      first_name: from?.first_name,
      last_name: from?.last_name,
      username: from?.username,
      user_id: from?.id,
      mention: from
        ? from.username
          ? `@${from.username}`
          : `<a href="tg://user?id=${from.id}">${from.first_name}</a>`
        : undefined,
      group_name: update.chat?.title,
      bot_name: ctx.bot.botInfo?.first_name ?? '',
      date: now.slice(0, 10),
      time: now.slice(11, 16),
    };
  }

  /**
   * Maps an item type to a human-readable section label.
   * @param {string} type - Raw item type.
   * @returns {string} Display label.
   */
  private labelForType(type: string): string {
    switch (type) {
      case 'folder':
        return 'Chat Folders';
      case 'channel':
        return 'Channels';
      case 'group':
        return 'Groups';
      default:
        return 'Links';
    }
  }
}
