import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { MiniAppsService } from './mini-apps.service';
import { Public } from '../../common/decorators/public.decorator';
import { TmaInitDataGuard, type TmaUser } from '../../common/guards/tma-init-data.guard';
import { DatabaseService } from '../../database/database.service';

/**
 * Public Mini App runtime endpoints consumed by the TMA webview shell. The
 * config fetch is fully public; every user-scoped route validates Telegram
 * `initData` through {@link TmaInitDataGuard}.
 */
@Controller('tma')
export class TmaController {
  /**
   * @param {MiniAppsService} service - Mini App studio service.
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(
    private readonly service: MiniAppsService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Returns the public runtime configuration for an app slug.
   * @param {string} slug - Mini App slug.
   * @returns {object} Template type, title, config, and theme.
   */
  @Public()
  @Get(':slug')
  config(@Param('slug') slug: string) {
    return this.service.getPublicConfig(slug);
  }

  /**
   * Returns loyalty balance and check-in status for the Mini App user.
   * @param {string} slug - Mini App slug.
   * @param {Request} req - Request carrying the validated user.
   * @returns {object} Points and check-in state.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Get(':slug/me')
  me(@Param('slug') slug: string, @Req() req: Request & { tmaUser?: TmaUser }) {
    const botId = this.botIdForSlug(slug);
    return this.service.getLoyalty(botId, req.tmaUser!.id);
  }

  /**
   * Performs the daily loyalty check-in.
   * @param {string} slug - Mini App slug.
   * @param {Request} req - Request carrying the validated user.
   * @returns {object} Award and updated balance.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/checkin')
  @HttpCode(200)
  checkin(@Param('slug') slug: string, @Req() req: Request & { tmaUser?: TmaUser }) {
    const botId = this.botIdForSlug(slug);
    return this.service.checkin(botId, req.tmaUser!.id);
  }

  /**
   * Records a shopping cart checkout.
   * @param {string} slug - Mini App slug.
   * @param {Request} req - Request carrying the validated user.
   * @param {object} body - `{ items: Array<{id, title, price, quantity}> }`.
   * @returns {object} Created order summary.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/order')
  @HttpCode(200)
  order(
    @Param('slug') slug: string,
    @Req() req: Request & { tmaUser?: TmaUser },
    @Body() body: { items?: Array<{ id: string; title: string; price: number; quantity: number }> },
  ) {
    const app = this.appForSlug(slug);
    return this.service.createOrder(app.bot_id, app.id, req.tmaUser!.id, body.items ?? []);
  }

  /**
   * Performs the daily reward-wheel spin.
   * @param {string} slug - Mini App slug.
   * @param {Request} req - Request carrying the validated user.
   * @param {object} body - `{ prizes: Array<{label, points}> }` from app config.
   * @returns {object} Drawn prize and updated balance.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/spin')
  @HttpCode(200)
  spin(
    @Param('slug') slug: string,
    @Req() req: Request & { tmaUser?: TmaUser },
    @Body() body: { prizes?: Array<{ label: string; points: number }> },
  ) {
    const botId = this.botIdForSlug(slug);
    return this.service.spin(botId, req.tmaUser!.id, body.prizes ?? []);
  }

  /**
   * Stores a form submission.
   * @param {string} slug - Mini App slug.
   * @param {Request} req - Request carrying the validated user.
   * @param {object} body - `{ answers: Record<string, unknown> }`.
   * @returns {{received: boolean}} Acknowledgement.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/form-submit')
  @HttpCode(200)
  formSubmit(
    @Param('slug') slug: string,
    @Req() req: Request & { tmaUser?: TmaUser },
    @Body() body: { answers?: Record<string, unknown> },
  ) {
    const app = this.appForSlug(slug);
    return this.service.submitForm(app.bot_id, app.id, req.tmaUser!.id, body.answers ?? {});
  }

  /**
   * Resolves the owning bot id for a slug.
   * @param {string} slug - Mini App slug.
   * @returns {number} Bot id.
   */
  private botIdForSlug(slug: string): number {
    return this.appForSlug(slug).bot_id;
  }

  /**
   * Loads the active app row for a slug.
   * @param {string} slug - Mini App slug.
   * @returns {{id: number; bot_id: number}} App identifiers.
   */
  private appForSlug(slug: string): { id: number; bot_id: number } {
    const app = this.db.get<{ id: number; bot_id: number }>(
      'SELECT id, bot_id FROM mini_apps WHERE slug = ? AND is_active = 1',
      slug,
    );
    return app ?? { id: 0, bot_id: 0 };
  }
}
