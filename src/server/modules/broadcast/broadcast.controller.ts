import { Body, Controller, Get, Param, Post, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { CreateBroadcastDto } from './dto/broadcast.dto';
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
  stream(@Param('botId') botId: string): import('rxjs').Observable<MessageEvent> {
    return this.live.stream('broadcasts', botId);
  }

  /**
   * Lists broadcast history.
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Broadcast rows, newest first.
   */
  @Get()
  list(@Param('botId') botId: string) {
    return this.service.list(botId);
  }

  /**
   * Queues a new broadcast (validated DTO: text/media/button/variant caps).
   * @param {number} botId - Owning bot id.
   * @param {CreateBroadcastDto} body - targetType, language, recentDays,
   * messageText, mediaUrl, buttons, variants, testSplitPercent.
   * @returns {object} Queued broadcast row(s).
   */
  @Post()
  create(@Param('botId') botId: string, @Body() body: CreateBroadcastDto) {
    return this.service.create(botId, body as unknown as Record<string, unknown>);
  }

  /**
   * Returns one broadcast with live counters.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Broadcast identifier.
   * @returns {object} Broadcast row.
   */
  @Get(':id')
  findOne(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.findOne(botId, id);
  }

  /**
   * Cancels a running or queued broadcast.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Broadcast identifier.
   * @returns {object} Broadcast row.
   */
  @Post(':id/cancel')
  cancel(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.cancel(botId, id);
  }

  /**
   * Resumes an interrupted broadcast from its persisted progress cursor;
   * recipients already processed before the interruption are skipped.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Interrupted broadcast identifier.
   * @returns {Promise<object>} Broadcast row re-queued for delivery.
   */
  @Post(':id/resume')
  resume(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.resume(botId, id);
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
    @Param('botId') botId: string,
    @Param('experimentId') experimentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const override =
      typeof body.variantBroadcastId === 'string' ? body.variantBroadcastId.trim() : undefined;
    return this.service.chooseWinner(botId, experimentId, override || undefined);
  }
}
