import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';
import { BotUserModel } from '../../models/bot-user.model';

/**
 * Runtime for the Affiliate & Referral Leaderboard module. Parses `ref_<id>`
 * deep-link start payloads, attributes referrals with point rewards, and
 * serves the leaderboard command.
 */
@Injectable()
export class ReferralsRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'referrals';

  /**
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {BotUserModel} userModel - Typed audience model.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly helpers: EngineHelpersService,
    private readonly userModel: BotUserModel,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches referral start-payload parsing and the leaderboard command.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const pointsPerReferral = Number(ctx.config.pointsPerReferral ?? 10);
    const leaderboardSize = Number(ctx.config.leaderboardSize ?? 10);

    bot.command('start', async (update) => {
      const payload = update.msg?.text?.replace(/^\/start(@\S+)?\s*/, '').trim() ?? '';
      const match = /^ref_(\d+)$/.exec(payload);
      if (!match || !update.from) return;
      const attributed = await this.helpers.setReferrer(
        ctx.botId,
        update.from.id,
        Number(match[1]),
        pointsPerReferral,
      );
      if (attributed) {
        void update.reply('You were referred successfully. Your friend earned bonus points.');
      }
    });

    bot.command('top', async (update) => {
      const rows = await this.userModel.getReferralTop(ctx.botId, leaderboardSize);
      if (rows.length === 0) {
        await update.reply('The leaderboard is empty.');
        return;
      }
      const lines = rows.map((row, index) => {
        const name = row.username
          ? `@${row.username}`
          : (row.first_name ?? String(row.telegram_id));
        return `${index + 1}. ${name} - ${row.points} pts`;
      });
      await update.reply(`<b>Referral Leaderboard</b>\n\n${lines.join('\n')}`, {
        parse_mode: 'HTML',
      });
    });
  }
}
