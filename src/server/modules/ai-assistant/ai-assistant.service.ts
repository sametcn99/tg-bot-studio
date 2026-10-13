import { Injectable, Logger } from '@nestjs/common';
import { AiModel } from '../../models/ai.model';
import { BotUserModel } from '../../models/bot-user.model';
import { MiniAppModel } from '../../models/mini-app.model';

/**
 * Chat message exchanged with an AI provider.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Effective AI assistant module configuration.
 */
export interface AiConfig {
  provider: 'openai' | 'gemini' | 'custom';
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  historyLimit: number;
}

/**
 * AI Knowledge Assistant service with RAG knowledge retrieval,
 * persistent chat history, and multimodal Whisper audio transcription.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly aiModel: AiModel,
    private readonly botUserModel: BotUserModel,
    private readonly miniAppModel: MiniAppModel,
  ) {}

  /**
   * Produces an assistant reply for the given conversation, enriching the prompt
   * with RAG knowledge base context and user context (points, orders) when applicable.
   */
  async completeWithContext(
    botId: number,
    telegramId: number,
    config: AiConfig,
    history: ChatMessage[],
  ): Promise<string> {
    if (!config.apiKey) {
      return 'The AI assistant is not configured with an API key yet.';
    }

    const latestUserMessage = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

    // 1. RAG Knowledge Retrieval
    const relevantDocs = await this.retrieveKnowledgeDocs(botId, latestUserMessage);

    // 2. User Tool Context (Points & Recent Orders)
    const userContext = await this.getUserActionContext(botId, telegramId, latestUserMessage);

    let systemPrompt =
      config.systemPrompt || 'You are a helpful customer support assistant for Telegram.';

    if (relevantDocs) {
      systemPrompt += `\n\n[OFFICIAL KNOWLEDGE BASE CONTEXT]\n${relevantDocs}\nAnswer user queries based strictly on the knowledge base above when relevant.`;
    }

    if (userContext) {
      systemPrompt += `\n\n[AUTHENTICATED USER CONTEXT]\n${userContext}`;
    }

    const effectiveConfig: AiConfig = {
      ...config,
      systemPrompt,
    };

    if (config.provider === 'gemini') {
      return this.callGemini(effectiveConfig, history);
    }
    return this.callOpenAi(effectiveConfig, history);
  }

  /**
   * Basic complete method for standalone requests.
   */
  async complete(config: AiConfig, history: ChatMessage[]): Promise<string> {
    if (!config.apiKey) {
      return 'The AI assistant is not configured with an API key yet.';
    }
    if (config.provider === 'gemini') {
      return this.callGemini(config, history);
    }
    return this.callOpenAi(config, history);
  }

  /**
   * Retrieves relevant knowledge documents matching terms in the query with tag awareness and chunking.
   */
  private async retrieveKnowledgeDocs(botId: number, query: string): Promise<string> {
    const docs = await this.aiModel.listDocs(botId);
    if (docs.length === 0) return '';

    const words = query
      .toLowerCase()
      .split(/[\s,.;:!?]+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) return '';

    const scoredDocs = docs
      .map((doc) => {
        const titleLower = (doc.title || '').toLowerCase();
        const tagsLower = (doc.tags || '').toLowerCase();
        const contentLower = (doc.content || '').toLowerCase();
        let score = 0;

        for (const word of words) {
          if (titleLower.includes(word)) score += 5;
          if (tagsLower.includes(word)) score += 4;
          if (contentLower.includes(word)) score += 1;
        }
        return { doc, score };
      })
      .filter((item) => item.score > 0);

    // If no matching terms found, return empty context (avoid hallucinating with unrelated docs)
    if (scoredDocs.length === 0) return '';

    scoredDocs.sort((a, b) => b.score - a.score);
    const chosen = scoredDocs.slice(0, 3).map((item) => item.doc);

    return chosen
      .map((d) => {
        const snippet = d.content.length > 1200 ? `${d.content.slice(0, 1200)}...` : d.content;
        return `### ${d.title}${d.tags ? ` [Tags: ${d.tags}]` : ''}\n${snippet}`;
      })
      .join('\n\n');
  }

  /**
   * Fetches user balance and orders if the query relates to account or orders.
   */
  private async getUserActionContext(
    botId: number,
    telegramId: number,
    query: string,
  ): Promise<string> {
    const lower = query.toLowerCase();
    const contextParts: string[] = [];

    if (
      lower.includes('point') ||
      lower.includes('puan') ||
      lower.includes('balance') ||
      lower.includes('bakiye')
    ) {
      const user = await this.botUserModel.findByTelegramId(botId, telegramId);
      if (user) {
        contextParts.push(`User loyalty points balance: ${user.points} points.`);
      }
    }

    if (
      lower.includes('order') ||
      lower.includes('siparis') ||
      lower.includes('kargo') ||
      lower.includes('status')
    ) {
      const orders = await this.miniAppModel.listUserOrders(botId, telegramId, 3);
      if (orders.length > 0) {
        const orderSummary = orders
          .map(
            (o) =>
              `Order #${o.id}: ${o.total_amount} ${o.currency}, status: ${o.status} (${o.created_at})`,
          )
          .join('; ');
        contextParts.push(`User recent orders: ${orderSummary}`);
      }
    }

    return contextParts.join('\n');
  }

  /**
   * Transcribes Telegram audio / voice message using OpenAI Whisper API.
   */
  async transcribeAudio(apiKey: string, audioBuffer: Buffer, filename: string): Promise<string> {
    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
      formData.append('file', blob, filename);
      formData.append('model', 'whisper-1');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Whisper API returned status ${response.status}`);
      }

      const result = (await response.json()) as { text?: string };
      return result.text ?? '';
    } catch (err) {
      this.logger.warn(
        `Whisper transcription failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }

  /**
   * Loads persisted conversation turns for a user from Prisma.
   */
  async getHistory(botId: number, telegramId: number, limit = 10): Promise<ChatMessage[]> {
    return this.aiModel.getHistory(botId, telegramId, limit);
  }

  /**
   * Appends a message to persistent chat history.
   */
  async saveMessage(
    botId: number,
    telegramId: number,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    await this.aiModel.saveMessage(botId, telegramId, role, content);
  }

  /**
   * Knowledge Docs CRUD: lists all docs for a bot.
   */
  async listDocs(botId: number) {
    return this.aiModel.listDocs(botId);
  }

  /**
   * Knowledge Docs CRUD: adds a new doc.
   */
  async addDoc(
    botId: number,
    title: string,
    content: string,
    tags?: string,
  ): Promise<{ id: number }> {
    return this.aiModel.addDoc(botId, title, content, tags);
  }

  /**
   * Knowledge Docs CRUD: updates an existing doc.
   */
  async updateDoc(
    botId: number,
    docId: number,
    title: string,
    content: string,
    tags?: string,
  ): Promise<void> {
    await this.aiModel.updateDoc(botId, docId, title, content, tags);
  }

  /**
   * Knowledge Docs CRUD: deletes a doc.
   */
  async removeDoc(botId: number, docId: number): Promise<void> {
    await this.aiModel.removeDoc(botId, docId);
  }

  private async callOpenAi(config: AiConfig, history: ChatMessage[]): Promise<string> {
    const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        max_tokens: config.maxTokens || 600,
        messages: [{ role: 'system', content: config.systemPrompt }, ...history],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`AI request to ${baseUrl} failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return payload.choices?.[0]?.message?.content ?? 'No response generated.';
  }

  private async callGemini(config: AiConfig, history: ChatMessage[]): Promise<string> {
    const model = config.model || 'gemini-2.0-flash';
    const contents = history.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: config.systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: config.maxTokens || 600 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return payload.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response generated.';
  }
}
