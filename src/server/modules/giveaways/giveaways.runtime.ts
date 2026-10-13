import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { GiveawaysService } from './giveaways.service';

/**
 * Runtime for the Giveaways & Contest Engine. Exposes a `/giveaway` command
 * listing active giveaways with join buttons, and a callback handler that
 * verifies required-channel membership before registering participation.
 */
@Injectable()
export class GiveawaysRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'giveaways';

  /**
   * @param {GiveawaysService} service - Giveaway engine service.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: GiveawaysService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches giveaway join middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;

    bot.command('giveaway', async (update) => {
      const active = (await this.service.list(ctx.botId)).filter(
        (giveaway) => giveaway.status === 'active',
      );
      if (active.length === 0) {
        await update.reply('There are no active giveaways right now.');
        return;
      }
      for (const giveaway of active) {
        const channels = giveaway.requiredChannels as string[];
        const requirement =
          channels.length > 0
            ? `\nRequired channels: ${channels.map((channel) => String(channel)).join(', ')}`
            : '';
        await update.reply(
          `<b>${giveaway.title}</b>\n${(giveaway.prize_details as string) ?? ''}\nWinners: ${giveaway.winners_count}\nEnds: ${giveaway.ends_at ?? 'manual draw'}${requirement}`,
          { parse_mode: 'HTML', reply_markup: this.service.joinKeyboard(giveaway.id as number) },
        );
      }
    });

    bot.on('callback_query:data', async (update) => {
      if (!update.callbackQuery.data.startsWith('giveaway:')) return;
      const [, giveawayIdRaw] = update.callbackQuery.data.split(':');
      const giveawayId = Number(giveawayIdRaw);
      const list = await this.service.list(ctx.botId);
      const giveaway = list.find((row) => row.id === giveawayId && row.status === 'active');
      if (!giveaway) {
        await update.answerCallbackQuery({ text: 'This giveaway is no longer active.' });
        return;
      }
      if (!update.callbackQuery.from) return;

      const channels = giveaway.requiredChannels as string[];
      const verified = await this.service.verifyMembership(
        ctx.botId,
        update.callbackQuery.from.id,
        channels,
      );
      if (!verified) {
        await update.answerCallbackQuery({
          text: 'Please join all required channels first, then try again.',
        });
        return;
      }
      const added = await this.service.addParticipant(
        ctx.botId,
        giveawayId,
        update.callbackQuery.from.id,
      );
      await update.answerCallbackQuery({
        text: added ? 'You are participating. Good luck.' : 'You are already participating.',
      });
    });
  }
}
