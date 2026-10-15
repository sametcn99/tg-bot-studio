import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { BotsService } from './bots.service';
import { CreateBotDto, UpdateBotDto, UpdateModuleStateDto, ValidateTokenDto } from './dto/bots.dto';
import { callGetMe } from '../common/utils/telegram.util';

/**
 * Bot registration and per-bot module toggle endpoints. Every route is
 * scoped by the studio JWT guard.
 */
@Controller('bots')
export class BotsController {
  /**
   * @param {BotsService} botsService - Bot CRUD service.
   */
  constructor(private readonly botsService: BotsService) {}

  /**
   * Lists all bots with runtime status and audience metrics.
   * @returns {object[]} Enriched bot records.
   */
  @Get()
  list() {
    return this.botsService.findAll();
  }

  /**
   * Validates a BotFather token via Telegram getMe without persisting.
   * @param {ValidateTokenDto} body - Token to verify.
   * @returns {Promise<object>} Validation result with bot profile.
   */
  @Post('validate')
  async validate(@Body() body: ValidateTokenDto) {
    const check = await callGetMe(body.token);
    return {
      ok: check.ok,
      bot: check.bot,
      description: check.description,
    };
  }

  /**
   * Registers a bot after credential validation.
   * @param {CreateBotDto} body - Token and optional display name.
   * @returns {Promise<object>} Created bot record.
   * @throws {BadRequestException} When Telegram rejects the token.
   */
  @Post()
  create(@Body() body: CreateBotDto) {
    return this.botsService.create(body);
  }

  /**
   * Fetches one bot with metrics.
   * @param {number} id - Studio bot identifier.
   * @returns {object} Enriched bot record.
   * @throws {NotFoundException} When the bot does not exist.
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.botsService.findOne(id);
  }

  /**
   * Updates bot metadata or enabled state.
   * @param {number} id - Studio bot identifier.
   * @param {UpdateBotDto} body - Patch fields.
   * @returns {Promise<object>} Updated bot record.
   */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateBotDto) {
    return this.botsService.update(id, body);
  }

  /**
   * Deletes a bot and all bot-scoped data.
   * @param {number} id - Studio bot identifier.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.botsService.remove(id);
    return { success: true };
  }

  /**
   * Reads bot-level operational settings (IANA time zone).
   */
  @Get(':id/settings')
  getSettings(@Param('id', ParseIntPipe) id: number) {
    return this.botsService.getBotSettings(id);
  }

  /**
   * Updates bot-level operational settings (IANA time zone).
   */
  @Patch(':id/settings')
  updateSettings(@Param('id', ParseIntPipe) id: number, @Body() body: { timezone?: string }) {
    return this.botsService.updateBotSettings(id, body);
  }

  /**
   * Lists all modules with effective state and config for a bot.
   * @param {number} id - Studio bot identifier.
   * @returns {object[]} Module descriptors.
   */
  @Get(':id/modules')
  listModules(@Param('id', ParseIntPipe) id: number) {
    return this.botsService.listModules(id);
  }

  /**
   * Toggles or reconfigures a module and hot-reloads the runtime.
   * @param {number} id - Studio bot identifier.
   * @param {string} moduleKey - Module registry key.
   * @param {UpdateModuleStateDto} body - Enabled flag and config.
   * @returns {Promise<object>} Updated module descriptor.
   */
  @Put(':id/modules/:moduleKey')
  updateModule(
    @Param('id', ParseIntPipe) id: number,
    @Param('moduleKey') moduleKey: string,
    @Body() body: UpdateModuleStateDto,
  ) {
    return this.botsService.updateModule(id, moduleKey, body);
  }

  /**
   * Runs diagnostic permission and health checks for a bot.
   * @param {number} id - Studio bot identifier.
   * @returns {Promise<object>} Diagnostic report.
   */
  @Get(':id/diagnostics')
  getDiagnostics(@Param('id', ParseIntPipe) id: number) {
    return this.botsService.getDiagnostics(id);
  }

  /**
   * Applies a one-click starter feature bundle for a bot.
   * @param {number} id - Studio bot identifier.
   * @param {string} presetKey - Bundle key.
   * @returns {Promise<object>} Result.
   */
  @Post(':id/presets/:presetKey')
  applyPreset(@Param('id', ParseIntPipe) id: number, @Param('presetKey') presetKey: string) {
    return this.botsService.applyPreset(id, presetKey);
  }

  /**
   * Simulates a message exchange in the in-studio sandbox simulator.
   * @param {number} id - Studio bot identifier.
   * @param {object} body - Payload with message text.
   * @returns {Promise<object>} Bot simulated response.
   */
  @Post(':id/simulator/send')
  simulateMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      message: string;
      chatType?: 'private' | 'supergroup' | 'group';
      event?: 'message' | 'join' | 'leave' | 'chat_member';
    },
  ) {
    return this.botsService.simulateMessage(id, body.message, {
      chatType: body.chatType,
      event: body.event,
    });
  }

  /**
   * Simulates an inline callback button press through the real module chain.
   */
  @Post(':id/simulator/callback')
  simulateCallback(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { callbackData: string; chatType?: 'private' | 'supergroup' | 'group' },
  ) {
    return this.botsService.simulateCallback(id, String(body.callbackData ?? ''), body.chatType);
  }

  /**
   * Clones a bot configuration to a new bot.
   */
  @Post(':id/clone')
  clone(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; token: string }) {
    return this.botsService.cloneBot(id, body);
  }

  /**
   * Exports a bot configuration bundle as JSON.
   */
  @Get(':id/export')
  export(@Param('id', ParseIntPipe) id: number) {
    return this.botsService.exportConfig(id);
  }

  /**
   * Imports a bot configuration bundle into an existing bot.
   */
  @Post(':id/import')
  import(@Param('id', ParseIntPipe) id: number, @Body() bundle: Record<string, unknown>) {
    return this.botsService.importConfig(id, bundle);
  }
}
