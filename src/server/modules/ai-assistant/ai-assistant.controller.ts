import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AiAssistantService, type AiConfig } from './ai-assistant.service';

/**
 * AI assistant testing endpoint used by the module configuration page.
 */
@Controller('bots/:botId/ai-assistant')
export class AiAssistantController {
  /**
   * @param {AiAssistantService} service - Provider gateway.
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(
    private readonly service: AiAssistantService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Sends a test message through the configured provider.
   * @param {number} botId - Owning bot id.
   * @param {object} body - `{ message: string }`.
   * @returns {Promise<{reply: string}>} Assistant reply.
   * @throws {BadRequestException} When the provider call fails.
   */
  @Post('test')
  async test(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { message?: string },
  ): Promise<{ reply: string }> {
    const row = this.db.get<{ config_json: string | null }>(
      "SELECT config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'ai-assistant'",
      botId,
    );
    const stored = row?.config_json ? (JSON.parse(row.config_json) as Partial<AiConfig>) : {};
    const config: AiConfig = {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini',
      systemPrompt: 'You are a professional customer support assistant.',
      maxTokens: 600,
      historyLimit: 6,
      ...stored,
    };

    try {
      const reply = await this.service.complete(config, [
        { role: 'user', content: String(body.message ?? 'Hello') },
      ]);
      return { reply };
    } catch (error) {
      throw new BadRequestException(
        `Provider call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
