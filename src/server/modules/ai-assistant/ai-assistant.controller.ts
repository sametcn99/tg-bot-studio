import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { AiAssistantService, type AiConfig } from './ai-assistant.service';
import { BotModel } from '../../models/bot.model';

/**
 * AI assistant testing and Knowledge Base RAG document management endpoints.
 */
@Controller('bots/:botId/ai-assistant')
export class AiAssistantController {
  constructor(
    private readonly service: AiAssistantService,
    private readonly botModel: BotModel,
  ) {}

  /**
   * Sends a test message through the configured provider with RAG context.
   */
  @Post('test')
  async test(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { message?: string },
  ): Promise<{ reply: string }> {
    const row = await this.botModel.getModule(botId, 'ai-assistant');
    const stored = row?.configJson ? (JSON.parse(row.configJson) as Partial<AiConfig>) : {};
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
  async listDocs(@Param('botId', ParseIntPipe) botId: number) {
    return this.service.listDocs(botId);
  }

  /**
   * Adds a new knowledge document for RAG retrieval.
   */
  @Post('docs')
  async addDoc(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { title: string; content: string; tags?: string },
  ) {
    if (!body.title || !body.content) {
      throw new BadRequestException('Title and content are required');
    }
    return this.service.addDoc(botId, body.title, body.content, body.tags);
  }

  /**
   * Updates an existing knowledge document.
   */
  @Put('docs/:docId')
  async updateDoc(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('docId', ParseIntPipe) docId: number,
    @Body() body: { title: string; content: string; tags?: string },
  ) {
    if (!body.title || !body.content) {
      throw new BadRequestException('Title and content are required');
    }
    await this.service.updateDoc(botId, docId, body.title, body.content, body.tags);
    return { success: true };
  }

  /**
   * Deletes a knowledge base document.
   */
  @Delete('docs/:docId')
  async removeDoc(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    await this.service.removeDoc(botId, docId);
    return { success: true };
  }
}
