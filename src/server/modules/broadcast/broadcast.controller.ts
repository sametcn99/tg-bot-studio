import { Body, Controller, Get, Param, ParseIntPipe, Post, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { LiveEventsService } from '../../common/live/live-events.service';

/**
 * Broadcast composition and history endpoints.
 */
@Controller('bots/:botId/broadcasts')
export class BroadcastController {
  /**
   * @param {BroadcastService} service - Broadcast engine service.
   * @param {LiveEventsService} live - Live change bus for SSE pings.
   */
  constructor(
    private readonly service: BroadcastService,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Server-Sent Events stream pinging whenever broadcast data changes
   * (queue, progress tick, cancel) for instant progress updates.
   */
  @Sse('stream')
  stream(@Param('botId', ParseIntPipe) botId: number): import('rxjs').Observable<MessageEvent> {
    return this.live.stream('broadcasts', botId);
  }

  /**
   * Lists broadcast history.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Broadcast rows, newest first.
   */
  @Get()
  list(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.list(botId);
  }

  /**
   * Queues a new broadcast.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - targetType, language, recentDays,
   * messageText, mediaUrl, buttons.
   * @returns {object} Queued broadcast row.
   */
  @Post()
  create(@Param('botId', ParseIntPipe) botId: number, @Body() body: Record<string, unknown>) {
    return this.service.create(botId, body);
  }

  /**
   * Returns one broadcast with live counters.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Broadcast identifier.
   * @returns {object} Broadcast row.
   */
  @Get(':id')
  findOne(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(botId, id);
  }

  /**
   * Cancels a running or queued broadcast.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Broadcast identifier.
   * @returns {object} Broadcast row.
   */
  @Post(':id/cancel')
  cancel(@Param('botId', ParseIntPipe) botId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.cancel(botId, id);
  }

  /**
   * Picks the winner of an A/B experiment (manual variant override or best
   * click-through) and queues the winner to the non-test audience.
   * @param {number} botId - Owning bot id.
   * @param {string} experimentId - Experiment group id.
   * @param {Record<string, unknown>} body - Optional `variantBroadcastId`.
   * @returns {Promise<object>} Winner and rollout broadcast rows.
   */
  @Post('experiments/:experimentId/choose-winner')
  chooseWinner(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('experimentId') experimentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const override = Number(body.variantBroadcastId);
    return this.service.chooseWinner(
      botId,
      experimentId,
      Number.isFinite(override) && override > 0 ? override : undefined,
    );
  }
}
