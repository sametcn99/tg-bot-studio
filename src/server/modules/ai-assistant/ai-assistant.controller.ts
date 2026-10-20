import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AiAssistantService, type AiConfig } from './ai-assistant.service';
import { BotModel } from '../../bots/bot.model';
import { StudioException } from '../../common/errors/studio-error';
import { safeJsonObjectParse } from '../../common/utils/json.util';

/** Per-kind system instructions for the form-content generator. */
const GENERATION_PROMPTS: Record<string, string> = {
  autoresponder:
    'Write a Telegram auto-responder reply for the described purpose. Return STRICT JSON only: {"text": "..."} — friendly, concise, with at most 2 emoji. Do not include markdown code fences.',
  'drip-steps':
    'Design a drip campaign step sequence for the described purpose. Return STRICT JSON only: an array of 3-5 objects [{"delayMinutes": <int>, "text": "..."}]. delayMinutes counts from the previous step (first step from subscription). Each text is a standalone Telegram message, 1-3 sentences. Do not include markdown code fences.',
  buttons:
    'Design a Telegram inline keyboard for the described purpose. Return STRICT JSON only: an array of rows, each row an array of 1-3 objects {"text": "...", "url": "https://..."} (max 8 buttons total; URLs must be plausible https links). Do not include markdown code fences.',
  broadcast:
    'Write a Telegram broadcast announcement for the described purpose. Return PLAIN TEXT only (no JSON, no fences), 2-5 short paragraphs, with at most 2 emoji and placeholders like {first_name} where natural.',
  'knowledge-faq':
    'Write a knowledge-base article (FAQ style) answering the described topic for a company bot. Return PLAIN MARKDOWN only (no code fences), starting with a "# Title" line, followed by concise Q&A or guideline sections.',
};

/** Bot-reply language codes with their English names for translation prompts. */
const TRANSLATION_LANGUAGES: Record<string, string> = {
  en: 'English',
  tr: 'Turkish',
  de: 'German',
  ru: 'Russian',
  es: 'Spanish',
  az: 'Azerbaijani',
  ar: 'Arabic',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  uk: 'Ukrainian',
  fa: 'Persian (Farsi)',
  id: 'Indonesian',
  uz: 'Uzbek',
};

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
   * Resolves the effective AI config from the bot's stored module config.
   */
  private async resolveConfig(botId: string): Promise<AiConfig> {
    const row = await this.botModel.getModule(botId, 'ai-assistant');
    const stored = safeJsonObjectParse<Partial<AiConfig>>(
      row?.configJson,
      {},
      'ai-assistant:config',
    );
    return {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini',
      systemPrompt: 'You are a professional customer support assistant.',
      maxTokens: 600,
      historyLimit: 6,
      ...stored,
    };
  }

  /**
   * Sends a test message through the configured provider with RAG context.
   * Returns the reply plus the matched knowledge chunks (citations).
   */
  @Post('test')
  async test(
    @Param('botId') botId: string,
    @Body() body: { message?: string },
  ): Promise<{
    reply: string;
    sources: Array<{ docId: string; docTitle: string; content: string; score: number }>;
  }> {
    const config = await this.resolveConfig(botId);
    const userMessage = String(body.message ?? 'Hello');
    try {
      const result = await this.service.completeWithSources(botId, 0, config, [
        { role: 'user', content: userMessage },
      ]);
      return { reply: result.reply, sources: result.sources };
    } catch (error) {
      throw new BadRequestException(
        `Provider call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Targeted content generation for studio forms ("✨ Create with AI").
   * Produces JSON (buttons, drip steps) or plain text per kind; the client
   * fills form fields with the result for the operator to edit.
   */
  @Post('generate')
  async generate(
    @Param('botId') botId: string,
    @Body() body: { kind?: string; prompt?: string; locale?: string },
  ): Promise<{ result: string }> {
    const kind = String(body.kind ?? '');
    const instructions = GENERATION_PROMPTS[kind];
    if (!instructions) {
      throw new StudioException('AI_KIND_UNKNOWN', 'Unknown generation kind');
    }
    const config = await this.resolveConfig(botId);
    if (!this.service.isConfigured(config)) {
      throw new StudioException(
        'AI_NOT_CONFIGURED',
        'The AI assistant is not configured with an API key yet.',
      );
    }
    const locale = body.locale === 'tr' ? 'tr' : 'en';
    const prompt = `Instructions for you:\n${instructions}\n\nUser brief: ${String(body.prompt ?? '').slice(0, 800) || '(none provided — invent something sensible for a Telegram bot)'}\n\nWrite the content in ${locale === 'tr' ? 'Turkish' : 'English'}.`;
    try {
      const raw = await this.service.complete({ ...config, systemPrompt: prompt, maxTokens: 800 }, [
        { role: 'user', content: prompt },
      ]);
      return { result: raw };
    } catch (error) {
      throw new BadRequestException(
        `Provider call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Translates labeled studio texts (welcome templates, rules, replies) into
   * any subset of the 14 supported bot languages in one provider call.
   * Placeholders like `{first_name}` are preserved verbatim.
   */
  @Post('translate')
  async translate(
    @Param('botId') botId: string,
    @Body() body: { texts?: Record<string, string>; targetLanguages?: string[] },
  ): Promise<{ translations: Record<string, Record<string, string>> }> {
    void botId;
    const texts = body.texts ?? {};
    const keys = Object.keys(texts).filter((key) => String(texts[key] ?? '').trim().length > 0);
    if (keys.length === 0) {
      throw new StudioException('TRANSLATE_EMPTY', 'Provide at least one non-empty text');
    }
    const requested = (body.targetLanguages ?? []).filter((code) => TRANSLATION_LANGUAGES[code]);
    const targets = requested.length > 0 ? requested : Object.keys(TRANSLATION_LANGUAGES);
    if (targets.length === 0) {
      throw new StudioException('TRANSLATE_LANG_UNKNOWN', 'No supported target language');
    }

    const config = await this.resolveConfig(botId);
    if (!this.service.isConfigured(config)) {
      throw new StudioException(
        'AI_NOT_CONFIGURED',
        'The AI assistant is not configured with an API key yet.',
      );
    }

    const sourceJson = JSON.stringify(
      Object.fromEntries(keys.map((key) => [key, String(texts[key]).slice(0, 2_000)])),
    );
    const languageList = targets
      .map((code) => `${code} (${TRANSLATION_LANGUAGES[code]})`)
      .join(', ');
    const prompt = [
      'You are a professional localization engine for Telegram bot content.',
      `Translate every value of the given JSON object into these languages: ${languageList}.`,
      'Keep Telegram placeholders like {first_name}, {mention}, {group_name} exactly as they are.',
      'Keep the tone friendly and concise; preserve emoji; do not add explanations.',
      'Return STRICT JSON only, no markdown fences, shaped exactly as:',
      '{"translations": {"<lang>": {"<key>": "<translated text>"}}}',
      `Input JSON: ${sourceJson}`,
    ].join('\n');

    try {
      const raw = await this.service.complete(
        { ...config, systemPrompt: prompt, maxTokens: Math.min(4_000, 400 * targets.length + 400) },
        [{ role: 'user', content: prompt }],
      );
      const parsed = this.parseJsonObject(raw) as {
        translations?: Record<string, Record<string, string>>;
      } | null;
      if (!parsed?.translations) {
        throw new BadRequestException('Provider returned an unparsable translation payload');
      }
      const translations: Record<string, Record<string, string>> = {};
      for (const code of targets) {
        const entry = parsed.translations[code];
        if (entry && typeof entry === 'object') {
          translations[code] = Object.fromEntries(
            keys
              .filter((key) => typeof entry[key] === 'string' && entry[key].trim())
              .map((key) => [key, String(entry[key])]),
          );
        }
      }
      return { translations };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `Provider call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extracts the first JSON object from a provider reply, tolerating code
   * fences and preambles.
   */
  private parseJsonObject(raw: string): Record<string, unknown> | null {
    let text = raw.trim();
    text = text
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = !inString;
      if (inString) continue;
      if (char === '{') depth++;
      if (char === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Aggregate AI usage metrics (requests, errors, tokens, latency) for the
   * trailing window, powering the mini metrics panel on the config page.
   */
  @Get('metrics')
  async metrics(@Param('botId') botId: string, @Query('days') days?: string) {
    const parsed = Math.max(1, Math.min(90, Number(days ?? 7) || 7));
    return this.service.getUsageSummary(botId, parsed);
  }

  /**
   * Rebuilds the semantic RAG index (chunking + embeddings) for every doc.
   */
  @Post('docs/reindex')
  async reindex(@Param('botId') botId: string) {
    const config = await this.resolveConfig(botId);
    const chunks = await this.service.indexKnowledgeBase(botId, config);
    return { chunks };
  }

  /**
   * Lists all knowledge base documents for this bot.
   */
  @Get('docs')
  async listDocs(@Param('botId') botId: string) {
    return this.service.listDocs(botId);
  }

  /**
   * Adds a new knowledge document for RAG retrieval.
   */
  @Post('docs')
  async addDoc(
    @Param('botId') botId: string,
    @Body() body: { title: string; content: string; tags?: string },
  ) {
    if (!body.title || !body.content) {
      throw new StudioException('DOC_CONTENT_REQUIRED', 'Title and content are required');
    }
    const config = await this.resolveConfig(botId);
    return this.service.addDoc(botId, body.title, body.content, body.tags, config);
  }

  /**
   * Updates an existing knowledge document.
   */
  @Put('docs/:docId')
  async updateDoc(
    @Param('botId') botId: string,
    @Param('docId') docId: string,
    @Body() body: { title: string; content: string; tags?: string },
  ) {
    if (!body.title || !body.content) {
      throw new StudioException('DOC_CONTENT_REQUIRED', 'Title and content are required');
    }
    const config = await this.resolveConfig(botId);
    await this.service.updateDoc(botId, docId, body.title, body.content, body.tags, config);
    return { success: true };
  }

  /**
   * Deletes a knowledge base document.
   */
  @Delete('docs/:docId')
  async removeDoc(@Param('botId') botId: string, @Param('docId') docId: string) {
    await this.service.removeDoc(botId, docId);
    return { success: true };
  }
}
