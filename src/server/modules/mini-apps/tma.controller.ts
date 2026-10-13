import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { MiniAppsService } from './mini-apps.service';
import { Public } from '../../common/decorators/public.decorator';
import { TmaInitDataGuard, type TmaUser } from '../../common/guards/tma-init-data.guard';
import { MiniAppModel } from '../../models/mini-app.model';

/**
 * Public Mini App runtime endpoints consumed by the TMA webview shell. The
 * config fetch is fully public; every user-scoped route validates Telegram
 * `initData` through {@link TmaInitDataGuard}.
 */
@Controller('tma')
export class TmaController {
  /**
   * @param {MiniAppsService} service - Mini App studio service.
   * @param {MiniAppModel} miniAppModel - Domain model for mini apps.
   */
  constructor(
    private readonly service: MiniAppsService,
    private readonly miniAppModel: MiniAppModel,
  ) {}

  /**
   * Returns the public runtime configuration for an app slug.
   * @param {string} slug - Mini App slug.
   * @returns {Promise<object>} Template type, title, config, and theme.
   */
  @Public()
  @Get(':slug')
  config(@Param('slug') slug: string) {
    return this.service.getPublicConfig(slug);
  }

  /**
   * Returns loyalty balance and check-in status for the Mini App user.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Get(':slug/me')
  async me(@Param('slug') slug: string, @Req() req: Request & { tmaUser?: TmaUser }) {
    const botId = await this.botIdForSlug(slug);
    return this.service.getLoyalty(botId, req.tmaUser!.id);
  }

  /**
   * Performs the daily loyalty check-in.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/checkin')
  @HttpCode(200)
  async checkin(@Param('slug') slug: string, @Req() req: Request & { tmaUser?: TmaUser }) {
    const botId = await this.botIdForSlug(slug);
    return this.service.checkin(botId, req.tmaUser!.id);
  }

  /**
   * Records a shopping cart checkout.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/order')
  @HttpCode(200)
  async order(
    @Param('slug') slug: string,
    @Req() req: Request & { tmaUser?: TmaUser },
    @Body() body: { items?: Array<{ id: string; title: string; price: number; quantity: number }> },
  ) {
    const app = await this.appForSlug(slug);
    return this.service.createOrder(app.bot_id, app.id, req.tmaUser!.id, body.items ?? []);
  }

  /**
   * Creates a Telegram Stars invoice for the cart (server-verified prices).
   * The TMA shell opens the returned link via `openInvoice`; the engine's
   * payment handlers validate pre-checkout and mark the order paid.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/checkout')
  @HttpCode(200)
  async checkout(
    @Param('slug') slug: string,
    @Req() req: Request & { tmaUser?: TmaUser },
    @Body() body: { items?: Array<{ id: string; quantity: number }> },
  ) {
    const app = await this.appForSlug(slug);
    return this.service.createStarsCheckout(app.bot_id, app.id, req.tmaUser!.id, body.items ?? []);
  }

  /**
   * Order status lookup for the buyer after opening an invoice.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Get(':slug/order/:orderId')
  async orderStatus(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
    @Req() req: Request & { tmaUser?: TmaUser },
  ) {
    const app = await this.appForSlug(slug);
    const parsed = Number(orderId);
    if (!Number.isFinite(parsed)) return null;
    return this.service.getOrderStatus(app.bot_id, app.id, parsed, req.tmaUser!.id);
  }

  /**
   * Performs the daily reward-wheel spin.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/spin')
  @HttpCode(200)
  async spin(
    @Param('slug') slug: string,
    @Req() req: Request & { tmaUser?: TmaUser },
    @Body() _body: { prizes?: Array<{ label: string; points: number }> },
  ) {
    const app = await this.appForSlug(slug);
    return this.service.spin(app.bot_id, app.id, req.tmaUser!.id);
  }

  /**
   * Stores a form submission.
   */
  @Public()
  @UseGuards(TmaInitDataGuard)
  @Post(':slug/form-submit')
  @HttpCode(200)
  async formSubmit(
    @Param('slug') slug: string,
    @Req() req: Request & { tmaUser?: TmaUser },
    @Body() body: { answers?: Record<string, unknown> },
  ) {
    const app = await this.appForSlug(slug);
    return this.service.submitForm(app.bot_id, app.id, req.tmaUser!.id, body.answers ?? {});
  }

  /**
   * Resolves the owning bot id for a slug.
   */
  private async botIdForSlug(slug: string): Promise<number> {
    const app = await this.appForSlug(slug);
    return app.bot_id;
  }

  /**
   * Loads the active app row for a slug.
   */
  private async appForSlug(slug: string): Promise<{ id: number; bot_id: number }> {
    const app = await this.miniAppModel.findBySlug(slug);
    if (!app || app.isActive !== 1) return { id: 0, bot_id: 0 };
    return { id: app.id, bot_id: app.botId };
  }
}
