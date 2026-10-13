import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AiAssistantService, type AiConfig } from './ai-assistant.service';

/**
 * AI assistant testing and Knowledge Base RAG document management endpoints.
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
   * Sends a test message through the configured provider with RAG context.
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
      const userMessage = String(body.message ?? 'Hello');
      const reply = await this.service.completeWithContext(
        botId,
        0, // dummy id for test
        config,
        [{ role: 'user', content: userMessage }],
      );
      return { reply };
    } catch (error) {
      throw new BadRequestException(
        `Provider call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Lists all knowledge base documents for this bot.
   */
  @Get('docs')
  listDocs(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.listDocs(botId);
  }

  /**
   * Adds a new knowledge document for RAG retrieval.
   */
  @Post('docs')
  addDoc(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { title: string; content: string; tags?: string },
  ) {
    if (!body.title || !body.content) {
      throw new BadRequestException('Title and content are required');
    }
    return this.service.addDoc(botId, body.title, body.content, body.tags);
  }

  /**
   * Deletes a knowledge base document.
   */
  @Delete('docs/:docId')
  removeDoc(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    this.service.removeDoc(botId, docId);
    return { success: true };
  }
}
